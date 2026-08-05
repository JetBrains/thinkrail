// The worktree change notifier: one recursive fs.watch per watched workspace, ignore-filtered and
// coalesced (see coalesce.ts) into a debounced `workspace.fsChanged` publish. The frame is an
// INVALIDATION NUDGE, not data — clients re-read via the read methods they already use, so a
// duplicate/lost frame can never corrupt state. Watchers start lazily (host calls `ensureWatch` when a
// workspace read lands — the read is the "a client is looking" signal) and degrade silently: a watcher
// that can't start or errors mid-flight is warned + dropped, leaving read-on-demand behavior intact.

import { type FSWatcher, readFileSync, statSync, watch } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import type { WorkspaceFsChangedPayload } from "@thinkrail/contracts";
import { loadProjects, loadWorkspaces } from "../persistence";
import { type Coalescer, createCoalescer } from "./coalesce";

const QUIET_MS = 300;
const MAX_WAIT_MS = 1000;
const MAX_PATHS = 100;
/**
 * Platform watch streams (FSEvents/inotify/kqueue) have a brief post-registration window where events
 * can drop. A write landing in that window would be lost forever (one batch is the only signal), so a
 * fresh watcher publishes ONE synthetic wildcard nudge after the window — receivers just refetch, and
 * a nudge with nothing changed is a cheap no-op re-read.
 */
const STARTUP_NUDGE_MS = 750;

/** Directory segments whose subtrees never notify (event storms: installs, git plumbing). */
const IGNORED_SEGMENTS = new Set([".git", "node_modules"]);
/** Exact file names that are pure noise. */
const IGNORED_NAMES = new Set([".DS_Store"]);
/**
 * Debounce for the repo-metadata nudge (below). Its own timer, not the file coalescer's: git plumbing
 * churns in bursts (a checkout, a commit, a rebase), and the nudge is a single "re-read the repo's HEAD"
 * signal — nothing to accumulate.
 */
const REPO_META_DEBOUNCE_MS = 300;

type WatchPublisher = (payload: WorkspaceFsChangedPayload) => void;
/** The repo-metadata nudge: "this workspace's git metadata moved" — no paths, it isn't file data. */
type RepoMetaPublisher = (workspaceId: string) => void;

let publish: WatchPublisher | null = null;
let publishRepoMeta: RepoMetaPublisher | null = null;

/** Host injects the `workspace.fsChanged` publish callback at wiring time (the tee pattern). */
export function setWatchPublisher(publisher: WatchPublisher | null): void {
	publish = publisher;
}

/**
 * Install (or clear) the **repo-metadata** sink: fired, debounced, whenever a watched worktree's git
 * metadata churns (a `git switch`/`commit`/`rebase` in a terminal) — the *only* signal for a change that
 * leaves the working tree byte-identical, e.g. `git switch -c <new-branch>` or a `git commit` (which moves
 * `HEAD` and empties the index while writing nothing under the worktree). Three sources feed it, one per
 * workspace whose watcher is currently live: `.git` events inside the recursive root watcher (a repo root),
 * the non-recursive watcher on the **resolved** git dir (a linked worktree's metadata lives in the parent
 * repo, outside the root — see `resolveExternalGitDir`), and the non-recursive watcher on the **project
 * repo's own** git dir (see `resolveProjectGitDir`) — the one place `refs/heads/*` actually lives, which a
 * `git branch` run in *any* worktree of the project writes and which neither of the first two ever sees,
 * because it is shared, not per-worktree. That third source fans out to every workspace of the project whose
 * watcher is currently live (one repo, many workspaces — never a watcher per workspace), reusing this exact
 * per-workspace debounce rather than adding a second one.
 *
 * The host turns it into two convergences: a **Default** workspace's folder-truth branch label
 * (`refreshDefaultWorkspace`) and a pathless client invalidation, so git-derived reads (`git.status`, an open
 * `working-tree`- or `staged`-scope diff tab) re-read when a ref moves. This sink stays **pathless** on
 * purpose: `.git` internals are not worktree content, so no `.git` path ever reaches a client.
 */
export function setRepoMetaPublisher(publisher: RepoMetaPublisher | null): void {
	publishRepoMeta = publisher;
}

/** Whether a watch event belongs to the worktree's own git metadata (its `.git` dir), not its content. */
function isRepoMetaPath(relPath: string): boolean {
	return relPath.split(/[\\/]/)[0] === ".git";
}

/**
 * The worktree's git metadata dir when it lies **outside** the watched root — else `null`.
 *
 * That dir (`HEAD`, `index`, `ORIG_HEAD`) is the only place a `git commit` / `reset` / `checkout` writes
 * when the working tree ends up byte-identical. For a **repo root** it is the in-tree `.git` *directory*,
 * already seen by the recursive root watcher (hence `null`: nothing to watch twice). For a **linked
 * worktree** — every workspace this app creates — `.git` is a *file* (`gitdir: <path>`) pointing at
 * `<repo>/.git/worktrees/<name>`, i.e. outside the root, where nothing would otherwise be observed at all.
 *
 * Resolved with plain fs, deliberately not by shelling out to `git rev-parse`: this module's boundary
 * allows `persistence` + Node only (no `git` sibling edge), and the gitfile format is a one-line contract.
 * Unreadable/absent metadata → `null` (a non-git folder; the caller just skips the second watcher).
 */
function resolveExternalGitDir(worktreePath: string): string | null {
	const dotGit = resolve(worktreePath, ".git");
	try {
		if (statSync(dotGit).isDirectory()) return null;
		const pointer = readFileSync(dotGit, "utf8").trim();
		const match = /^gitdir:\s*(.+)$/.exec(pointer);
		if (!match?.[1]) return null;
		const target = match[1].trim();
		const abs = isAbsolute(target) ? target : resolve(worktreePath, target);
		return statSync(abs).isDirectory() ? abs : null;
	} catch {
		return null;
	}
}

/**
 * Watch a worktree's out-of-root git metadata dir (see {@link resolveExternalGitDir}) — **non-recursive**,
 * because only its top level holds the refs that move (`HEAD`, `index`, `ORIG_HEAD`) and its subtrees
 * (`objects/`, `logs/`) are pure storms. Every event there is a metadata nudge, never a client path.
 * A failed start degrades silently: the root watcher (and read-on-demand) still stand.
 */
function watchGitDir(
	workspaceId: string,
	gitDir: string,
	rootWatcher: FSWatcher,
): FSWatcher | null {
	try {
		const watcher = watch(gitDir, { recursive: false }, () => {
			scheduleRepoMeta(workspaceId, rootWatcher);
		});
		watcher.on("error", (err) => {
			console.warn(`git metadata watcher for ${workspaceId} failed: ${err}`);
			watcher.close();
			const entry = entries.get(workspaceId);
			if (entry?.metaWatcher === watcher) entry.metaWatcher = null;
		});
		return watcher;
	} catch (err) {
		console.warn(`could not watch git metadata for ${workspaceId}: ${err}`);
		return null;
	}
}

/**
 * (Re)arm the debounced repo-metadata nudge for a workspace — fired once a burst of `.git` writes goes
 * quiet, and only while this watcher is still the live one (a torn-down watcher never publishes).
 */
function scheduleRepoMeta(workspaceId: string, watcher: FSWatcher): void {
	const entry = entries.get(workspaceId);
	if (entry && entry.watcher !== watcher) return;
	if (entry?.metaTimer) clearTimeout(entry.metaTimer);
	const timer = setTimeout(() => {
		const live = entries.get(workspaceId);
		if (!live || live.watcher !== watcher) return;
		live.metaTimer = null;
		publishRepoMeta?.(workspaceId);
	}, REPO_META_DEBOUNCE_MS);
	if (entry) entry.metaTimer = timer;
}

/** True when a watch event's relative path should not notify anyone. */
export function isIgnoredPath(relPath: string): boolean {
	const segments = relPath.split(/[\\/]/);
	if (segments.some((s) => IGNORED_SEGMENTS.has(s))) return true;
	const name = segments[segments.length - 1];
	return name !== undefined && IGNORED_NAMES.has(name);
}

interface WatchEntry {
	watcher: FSWatcher;
	coalescer: Coalescer;
	/** Inode of the watched root — a recreated dir at the same path (delete + re-create) gets a new
	 * inode, and the old watcher silently follows the dead one, so identity must be re-checked. */
	rootIno: number;
	/** The pending one-shot startup nudge, cleared on stop so a torn-down watcher never publishes. */
	nudgeTimer: ReturnType<typeof setTimeout>;
	/** The pending debounced repo-metadata nudge (see `setRepoMetaPublisher`), cleared on stop. */
	metaTimer: ReturnType<typeof setTimeout> | null;
	/** The non-recursive watcher on the resolved git metadata dir (see `watchGitDir`); null if absent. */
	metaWatcher: FSWatcher | null;
	/** Which project this workspace belongs to — lets the project git-dir watcher (see `ensureProjectWatch`)
	 * find every currently-watched workspace of a project without a second, project-keyed watcher registry. */
	projectId: string;
}

const entries = new Map<string, WatchEntry>();

/**
 * The project repo's OWN git dir (`<project.path>/.git`) — the directory every worktree of the repo shares,
 * where `refs/heads/*`, `packed-refs`, and the main worktree's own `HEAD`/`index` live. Every workspace this
 * app creates hangs off `project.path` via `git worktree add`, so `project.path` is always the repo's main
 * working tree: its `.git` is a real directory, never a gitfile pointer (that shape only ever appears for a
 * *linked* worktree, which this app never opens as a project). Resolved with plain fs, the same boundary as
 * `resolveExternalGitDir`: no `git` sibling edge. A missing/odd `.git` (not a directory) degrades silently —
 * the caller just skips the project watcher.
 */
function resolveProjectGitDir(projectPath: string): string | null {
	const dotGit = resolve(projectPath, ".git");
	try {
		return statSync(dotGit).isDirectory() ? dotGit : null;
	} catch {
		return null;
	}
}

interface ProjectWatchEntry {
	watcher: FSWatcher;
	/** Inode of the watched project git dir — self-healed exactly like a worktree root (see `ensureWatch`):
	 * a delete + re-create at the same path (e.g. `git init` run again) gets a new inode, and the old watcher
	 * silently follows the dead one. */
	gitDirIno: number;
}

/** One watcher per PROJECT REPO, not per workspace — many workspaces share the one git dir being watched
 * here, so this is keyed by `projectId`, never by `workspaceId` (see `ensureProjectWatch`). */
const projectWatchers = new Map<string, ProjectWatchEntry>();

/**
 * Start (or repair) the ONE watcher for a project's shared git dir. Called from every `ensureWatch` for any
 * of its workspaces, and idempotent for the same reason: many workspaces can share one project repo, and
 * this must never become a watcher per workspace (the fan-out below reaches every one of them from a single
 * stream). Self-heals like the worktree-root watcher: re-stats the git dir on every call and re-creates it
 * on inode change; a missing/non-git `.git` or a failed start degrades silently (warned, retried on the next
 * call — read-on-demand still stands).
 *
 * Non-recursive on purpose (a recursive watch on this dir would storm on every object write during a
 * `fetch`/`gc`, for a directory every workspace of the project shares) — but be clear-eyed about what that
 * buys here, which is *less* than for the linked-worktree watcher above. That one gets away with
 * non-recursive because the refs that move for it (`HEAD`, `index`, `ORIG_HEAD`) sit at the watched dir's
 * top level. `refs/heads/<name>` — what a plain `git branch <name>` writes — is *two levels* below this
 * dir, and non-recursive `fs.watch` on darwin only sees the watched dir's direct children (kqueue
 * semantics): measured directly, a settled non-recursive watch on a real repo's `.git` saw **zero** events
 * for a bare nested write, and only ~50% for a real `git branch` (every firing mis-attributed to a
 * top-level `HEAD.lock` rename that `git branch` never touches — FSEvents coalescing noise, not a real
 * signal). What this watcher *does* reliably catch: any write that touches a genuine top-level entry —
 * `packed-refs` (rewritten by `git gc` / `fetch --prune` / `pack-refs`), or the project's own `HEAD`/`index`
 * if the project itself is checked out and edited directly. Loose `refs/heads/*` creation from a plain
 * `git branch` is a known, open gap — see `packages/server/src/watch/SPEC.md` and
 * `.superpowers/sdd/2026-08-04-remote-awareness/task-7-report.md` for the full measurement.
 */
function ensureProjectWatch(projectId: string, projectPath: string): void {
	const gitDir = resolveProjectGitDir(projectPath);
	if (!gitDir) {
		stopProjectWatch(projectId); // no longer a git folder — drop any stale watcher
		return;
	}
	let gitDirIno: number;
	try {
		gitDirIno = statSync(gitDir).ino;
	} catch {
		stopProjectWatch(projectId);
		return;
	}
	const existing = projectWatchers.get(projectId);
	if (existing) {
		if (existing.gitDirIno === gitDirIno) return;
		stopProjectWatch(projectId); // same path, new inode — the old watcher is dead, re-create
	}

	try {
		const watcher = watch(gitDir, { recursive: false }, () => {
			nudgeProjectWorkspaces(projectId);
		});
		watcher.on("error", (err) => {
			console.warn(`project git-dir watcher for ${projectId} failed: ${err}`);
			watcher.close();
			if (projectWatchers.get(projectId)?.watcher === watcher) projectWatchers.delete(projectId);
		});
		projectWatchers.set(projectId, { watcher, gitDirIno });
	} catch (err) {
		console.warn(`could not watch project git dir for ${projectId}: ${err}`);
	}
}

/** Stop a project's git-dir watcher (its project record vanished; server shutdown). Idempotent. */
function stopProjectWatch(projectId: string): void {
	const entry = projectWatchers.get(projectId);
	if (!entry) return;
	projectWatchers.delete(projectId);
	entry.watcher.close();
}

/**
 * A write in the project's shared git dir (`git branch`/`fetch`/`reset` run in ANY of its worktrees) — fan
 * out to the existing per-workspace repo-metadata debounce (`scheduleRepoMeta`) for every workspace of this
 * project whose OWN watcher is currently live. Deliberately reuses that debounce untouched rather than
 * arming a second, project-keyed one: each affected workspace gets exactly the same 300ms coalescing a
 * same-worktree `.git` write already gets. An unwatched workspace of the project has no client looking, so
 * there is nothing to debounce for it yet — its next read re-derives fresh state regardless.
 */
function nudgeProjectWorkspaces(projectId: string): void {
	for (const [workspaceId, entry] of entries) {
		if (entry.projectId === projectId) scheduleRepoMeta(workspaceId, entry.watcher);
	}
}

/**
 * Start (or repair) the watcher for a workspace's worktree — idempotent and self-healing, called by
 * `host` on every workspace read: an unknown workspace or a missing root is a no-op, a live watcher
 * whose root inode still matches returns fast (one stat), and a stale watcher (root deleted/recreated
 * out-of-band — nothing went through `workspace.remove`) is torn down and re-created. A failed start
 * is warned and left absent — the next read simply retries. Also reaps zombie watchers whose workspace
 * record is gone (a worktree removed out-of-band can resurrect its path-based stream and keep
 * publishing for a forgotten id). Also (re)starts the project's shared git-dir watcher (see
 * `ensureProjectWatch`) for `ws`'s project — one per project repo, reaping its own zombies the same way.
 */
export function ensureWatch(workspaceId: string): void {
	const workspaces = loadWorkspaces();
	for (const id of [...entries.keys()]) {
		if (!workspaces.some((w) => w.id === id)) stopWatch(id);
	}
	const projects = loadProjects();
	for (const id of [...projectWatchers.keys()]) {
		if (!projects.some((p) => p.id === id)) stopProjectWatch(id);
	}
	const ws = workspaces.find((w) => w.id === workspaceId);
	if (!ws) return;

	const project = projects.find((p) => p.id === ws.projectId);
	if (project) ensureProjectWatch(project.id, project.path);

	let rootIno: number;
	try {
		rootIno = statSync(ws.worktreePath).ino;
	} catch {
		stopWatch(workspaceId); // root gone — drop any stale watcher; a later read retries
		return;
	}
	const existing = entries.get(workspaceId);
	if (existing) {
		if (existing.rootIno === rootIno) return;
		stopWatch(workspaceId); // same path, new inode — the old watcher is dead, re-create
	}

	const coalescer = createCoalescer({
		quietMs: QUIET_MS,
		maxWaitMs: MAX_WAIT_MS,
		maxPaths: MAX_PATHS,
		onFlush: ({ paths, truncated }) => {
			publish?.({ workspaceId, paths, truncated });
		},
	});

	try {
		const watcher = watch(ws.worktreePath, { recursive: true }, (_event, filename) => {
			// `filename` can be null (platform edge) → treat as wildcard rather than dropping the signal.
			const rel = typeof filename === "string" ? filename.replaceAll("\\", "/") : null;
			// A `.git` write is metadata, not content: it never reaches clients as a path (the blackout below
			// stands — plumbing storms must not become fsChanged frames), it only nudges the repo-meta sink.
			// A wildcard (unknown path) nudges both, since it may well *be* a metadata change.
			if (rel === null || isRepoMetaPath(rel)) scheduleRepoMeta(workspaceId, watcher);
			if (rel !== null && isIgnoredPath(rel)) return;
			coalescer.add(rel);
		});
		// A mid-flight error (worktree root deleted externally, ENOSPC): drop the watcher — the next
		// workspace read re-creates it if the root is back, else panels degrade to read-on-demand.
		watcher.on("error", (err) => {
			console.warn(`worktree watcher for ${workspaceId} failed: ${err}`);
			stopWatch(workspaceId);
		});
		const nudgeTimer = setTimeout(() => {
			if (entries.get(workspaceId)?.watcher === watcher) {
				publish?.({ workspaceId, paths: [], truncated: true });
			}
		}, STARTUP_NUDGE_MS);
		const gitDir = resolveExternalGitDir(ws.worktreePath);
		const entry: WatchEntry = {
			watcher,
			coalescer,
			rootIno,
			nudgeTimer,
			metaTimer: null,
			metaWatcher: null,
			projectId: ws.projectId,
		};
		// Registered after the entry is in the map: the git-dir watcher's callback resolves it through
		// `scheduleRepoMeta` (live-watcher identity check), and a write can land the moment the stream opens.
		entries.set(workspaceId, entry);
		if (gitDir) entry.metaWatcher = watchGitDir(workspaceId, gitDir, watcher);
	} catch (err) {
		coalescer.dispose();
		console.warn(`could not watch worktree for ${workspaceId}: ${err}`);
	}
}

/** Stop a workspace's watcher (workspace archive; idempotent). Pending un-flushed paths are dropped. */
export function stopWatch(workspaceId: string): void {
	const entry = entries.get(workspaceId);
	if (!entry) return;
	entries.delete(workspaceId);
	clearTimeout(entry.nudgeTimer);
	if (entry.metaTimer) clearTimeout(entry.metaTimer);
	entry.metaWatcher?.close();
	entry.coalescer.dispose();
	entry.watcher.close();
}

/** Server shutdown: stop every watcher — per-workspace and per-project. */
export function stopAllWatches(): void {
	for (const id of [...entries.keys()]) stopWatch(id);
	for (const id of [...projectWatchers.keys()]) stopProjectWatch(id);
}
