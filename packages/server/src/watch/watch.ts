// The worktree change notifier: one recursive fs.watch per watched workspace, ignore-filtered and
// coalesced (see coalesce.ts) into a debounced `workspace.fsChanged` publish. The frame is an
// INVALIDATION NUDGE, not data — clients re-read via the read methods they already use, so a
// duplicate/lost frame can never corrupt state. Watchers start lazily (host calls `ensureWatch` when a
// workspace read lands — the read is the "a client is looking" signal) and degrade silently: a watcher
// that can't start or errors mid-flight is warned + dropped, leaving read-on-demand behavior intact.

import { type FSWatcher, readFileSync, statSync, watch } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import type { WorkspaceFsChangedPayload } from "@thinkrail/contracts";
import { loadWorkspaces } from "../persistence";
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
 * `HEAD` and empties the index while writing nothing under the worktree). Two sources feed it: `.git`
 * events inside the recursive root watcher (a repo root), and the non-recursive watcher on the **resolved**
 * git dir (a linked worktree's metadata lives in the parent repo, outside the root — see `resolveGitDir`).
 *
 * The host turns it into two convergences: a **Default** workspace's folder-truth branch label
 * (`refreshDefaultWorkspace`) and a pathless client invalidation, so git-derived reads (`git.status`, an
 * `uncommitted`-scope diff tab) re-read when a ref moves. This sink stays **pathless** on purpose: `.git`
 * internals are not worktree content, so no `.git` path ever reaches a client.
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
}

const entries = new Map<string, WatchEntry>();

/**
 * Start (or repair) the watcher for a workspace's worktree — idempotent and self-healing, called by
 * `host` on every workspace read: an unknown workspace or a missing root is a no-op, a live watcher
 * whose root inode still matches returns fast (one stat), and a stale watcher (root deleted/recreated
 * out-of-band — nothing went through `workspace.remove`) is torn down and re-created. A failed start
 * is warned and left absent — the next read simply retries. Also reaps zombie watchers whose workspace
 * record is gone (a worktree removed out-of-band can resurrect its path-based stream and keep
 * publishing for a forgotten id).
 */
export function ensureWatch(workspaceId: string): void {
	const workspaces = loadWorkspaces();
	for (const id of [...entries.keys()]) {
		if (!workspaces.some((w) => w.id === id)) stopWatch(id);
	}
	const ws = workspaces.find((w) => w.id === workspaceId);
	if (!ws) return;

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

/** Server shutdown: stop every watcher. */
export function stopAllWatches(): void {
	for (const id of [...entries.keys()]) stopWatch(id);
}
