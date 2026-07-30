// The worktree change notifier: one recursive fs.watch per watched workspace, ignore-filtered and
// coalesced (see coalesce.ts) into a debounced `workspace.fsChanged` publish. The frame is an
// INVALIDATION NUDGE, not data — clients re-read via the read methods they already use, so a
// duplicate/lost frame can never corrupt state. Watchers start lazily (host calls `ensureWatch` when a
// workspace read lands — the read is the "a client is looking" signal) and degrade silently: a watcher
// that can't start or errors mid-flight is warned + dropped, leaving read-on-demand behavior intact.

import { type FSWatcher, statSync, watch } from "node:fs";
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
 * Install (or clear) the **repo-metadata** sink: fired, debounced, whenever a watched worktree's own
 * `.git` metadata churns (a `git switch`/`commit`/`rebase` in a terminal) — the *only* signal for a
 * change that leaves the working tree byte-identical, e.g. `git switch -c <new-branch>`, which writes
 * nothing outside `.git` and would otherwise be invisible to this module. The host uses it to re-sync a
 * **Default** workspace's folder-truth branch (`refreshDefaultWorkspace`) so every branch label converges
 * live. Deliberately NOT a client push: `.git` internals are not worktree content, and the app's clients
 * re-read state through the workspace-lifecycle event the host emits from this.
 */
export function setRepoMetaPublisher(publisher: RepoMetaPublisher | null): void {
	publishRepoMeta = publisher;
}

/** Whether a watch event belongs to the worktree's own git metadata (its `.git` dir), not its content. */
function isRepoMetaPath(relPath: string): boolean {
	return relPath.split(/[\\/]/)[0] === ".git";
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
		entries.set(workspaceId, { watcher, coalescer, rootIno, nudgeTimer, metaTimer: null });
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
	entry.coalescer.dispose();
	entry.watcher.close();
}

/** Server shutdown: stop every watcher. */
export function stopAllWatches(): void {
	for (const id of [...entries.keys()]) stopWatch(id);
}
