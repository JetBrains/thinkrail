import { type FSWatcher, readFileSync, statSync, watch } from "node:fs";
import { basename, dirname, isAbsolute, resolve, sep } from "node:path";
import type {
	WorkspaceFsChangedPayload,
	WorkspaceSkillChange,
	WorkspaceWatchReadyResult,
} from "@thinkrail/contracts";
import { logger } from "../log";
import { loadWorkspaces } from "../persistence";
import { type Coalescer, createCoalescer } from "./coalesce";

const log = logger("watch");

const QUIET_MS = 300;
const MAX_WAIT_MS = 1000;
const MAX_PATHS = 100;
const STARTUP_NUDGE_MS = 750;
const MAX_PREWARM_ONLY_WATCHES = 8;

const IGNORED_SEGMENTS = new Set([".git", "node_modules"]);
const IGNORED_NAMES = new Set([".DS_Store"]);
const REPO_META_DEBOUNCE_MS = 300;

type WatchPublisher = (payload: WorkspaceFsChangedPayload) => void;
type SkillPathClassifier = (relativePath: string) => boolean;
type RepoMetaPublisher = (workspaceId: string) => void;
type WatchStartedPublisher = (workspaceId: string) => void;

const ALREADY_READY: WorkspaceWatchReadyResult = { startupNudge: false };
const STARTUP_NUDGE: WorkspaceWatchReadyResult = { startupNudge: true };
const alreadyReady = Promise.resolve(ALREADY_READY);
const startupFallback = Promise.resolve(STARTUP_NUDGE);

let publish: WatchPublisher | null = null;
let publishRepoMeta: RepoMetaPublisher | null = null;
let publishWatchStarted: WatchStartedPublisher | null = null;
let isSkillPath: SkillPathClassifier | null = null;

export function setWatchPublisher(publisher: WatchPublisher | null): void {
	publish = publisher;
}

export function setSkillPathClassifier(classifier: SkillPathClassifier | null): void {
	isSkillPath = classifier;
}

export function setRepoMetaPublisher(publisher: RepoMetaPublisher | null): void {
	publishRepoMeta = publisher;
}

export function setWatchStartedPublisher(publisher: WatchStartedPublisher | null): void {
	publishWatchStarted = publisher;
}

function isRepoMetaPath(relPath: string): boolean {
	return relPath.split(/[\\/]/)[0] === ".git";
}

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

function sharedGitDir(gitDir: string): string | null {
	try {
		const pointer = readFileSync(resolve(gitDir, "commondir"), "utf8").trim();
		const dir = isAbsolute(pointer) ? pointer : resolve(gitDir, pointer);
		return statSync(dir).isDirectory() ? dir : null;
	} catch {
		return null;
	}
}

function upstreamTrackingRef(gitDir: string, commonDir: string): string | null {
	try {
		const branch = /^ref: refs\/heads\/(.+)$/.exec(
			readFileSync(resolve(gitDir, "HEAD"), "utf8").trim(),
		)?.[1];
		if (!branch) return null;

		let inBranch = false;
		let remote: string | null = null;
		let merge: string | null = null;
		const config = readFileSync(resolve(commonDir, "config"), "utf8");

		for (const line of config.split(/\r?\n/)) {
			const section = /^\s*\[([^\]]+)\]\s*$/.exec(line);
			if (section) {
				inBranch = section[1] === `branch "${branch}"`;
				continue;
			}
			if (!inBranch) continue;
			const option = /^\s*(remote|merge)\s*=\s*(.*?)\s*$/i.exec(line);
			if (option?.[1]?.toLowerCase() === "remote") remote = option[2] ?? null;
			if (option?.[1]?.toLowerCase() === "merge") merge = option[2] ?? null;
		}

		if (!remote || remote === "." || !merge?.startsWith("refs/heads/")) {
			return null;
		}

		const root = resolve(commonDir, "refs", "remotes");
		const ref = resolve(root, remote, merge.slice("refs/heads/".length));
		return ref.startsWith(root + sep) ? ref : null;
	} catch {
		return null;
	}
}

function syncRemoteRefWatch(
	workspaceId: string,
	rootWatcher: FSWatcher,
	gitDir: string,
	commonDir: string,
): void {
	const entry = entries.get(workspaceId);
	if (!entry || entry.watcher !== rootWatcher) return;

	const ref = upstreamTrackingRef(gitDir, commonDir);
	const parent = ref ? dirname(ref) : null;

	if (entry.remoteWatcher && entry.remoteWatchDir === parent && entry.remoteWatchRef === ref)
		return;

	entry.remoteWatcher?.close();
	entry.remoteWatcher = null;
	entry.remoteWatchDir = null;
	entry.remoteWatchRef = null;

	if (!ref || !parent) return;

	try {
		const leaf = basename(ref);
		const watcher = watch(parent, { recursive: false }, (_event, filename) => {
			const name = filename?.toString();
			if (name == null || name === leaf || name === `${leaf}.lock`) {
				scheduleRepoMeta(workspaceId, rootWatcher);
			}
		});

		watcher.on("error", () => {
			watcher.close();
			if (entry.remoteWatcher === watcher) {
				entry.remoteWatcher = null;
				entry.remoteWatchDir = null;
				entry.remoteWatchRef = null;
			}
		});

		entry.remoteWatcher = watcher;
		entry.remoteWatchDir = parent;
		entry.remoteWatchRef = ref;
	} catch {
		// First push may not have created the tracking-ref directory yet.
	}
}

function watchGitDir(
	workspaceId: string,
	gitDir: string,
	rootWatcher: FSWatcher,
	onHeadChange?: () => void,
): FSWatcher | null {
	try {
		const watcher = watch(gitDir, { recursive: false }, (_event, changed) => {
			if (changed == null || changed.toString() === "HEAD") onHeadChange?.();
			scheduleRepoMeta(workspaceId, rootWatcher);
		});
		watcher.on("error", () => {
			log.warn(`git metadata watcher failed for workspace ${workspaceId}`);
			watcher.close();
			const entry = entries.get(workspaceId);
			if (entry?.metaWatcher === watcher) entry.metaWatcher = null;
		});
		return watcher;
	} catch {
		log.warn(`could not watch git metadata for workspace ${workspaceId}`);
		return null;
	}
}

function deliver(sink: string, workspaceId: string, send: () => void): void {
	try {
		send();
	} catch (error) {
		log.warn(`${sink} publisher failed for workspace ${workspaceId}`, error as Error);
	}
}

function scheduleRepoMeta(workspaceId: string, watcher: FSWatcher): void {
	const entry = entries.get(workspaceId);
	if (entry && entry.watcher !== watcher) return;
	if (entry?.metaTimer) clearTimeout(entry.metaTimer);
	const timer = setTimeout(() => {
		const live = entries.get(workspaceId);
		if (!live || live.watcher !== watcher) return;
		live.metaTimer = null;
		deliver("repo-meta", workspaceId, () => publishRepoMeta?.(workspaceId));
	}, REPO_META_DEBOUNCE_MS);
	if (entry) entry.metaTimer = timer;
}

export function isIgnoredPath(relPath: string): boolean {
	const segments = relPath.split(/[\\/]/);
	if (segments.some((s) => IGNORED_SEGMENTS.has(s))) return true;
	const name = segments[segments.length - 1];
	return name !== undefined && IGNORED_NAMES.has(name);
}

interface WatchEntry {
	watcher: FSWatcher;
	coalescer: Coalescer;
	rootIno: number;
	nudgeTimer: ReturnType<typeof setTimeout> | null;
	ready: Promise<WorkspaceWatchReadyResult>;
	resolveReady: (result: WorkspaceWatchReadyResult) => void;
	readySettled: boolean;
	prewarmOnly: boolean;
	metaTimer: ReturnType<typeof setTimeout> | null;
	metaWatcher: FSWatcher | null;
	commonWatcher: FSWatcher | null;
	remoteWatcher: FSWatcher | null;
	remoteWatchDir: string | null;
	remoteWatchRef: string | null;
	configRetryTimer: ReturnType<typeof setTimeout> | null;
}

const entries = new Map<string, WatchEntry>();

function settleReady(entry: WatchEntry): void {
	if (entry.readySettled) return;
	entry.readySettled = true;
	entry.resolveReady(STARTUP_NUDGE);
}

function evictExcessPrewarmOnlyWatches(): void {
	const prewarmOnlyIds = [...entries].filter(([, e]) => e.prewarmOnly).map(([id]) => id);
	const excess = prewarmOnlyIds.length - MAX_PREWARM_ONLY_WATCHES;
	for (const id of prewarmOnlyIds.slice(0, Math.max(0, excess))) stopWatch(id);
}

export function ensureWatch(
	workspaceId: string,
	options?: { prewarm?: boolean },
): Promise<WorkspaceWatchReadyResult> {
	const prewarm = options?.prewarm === true;
	const workspaces = loadWorkspaces();
	for (const id of [...entries.keys()]) {
		if (!workspaces.some((w) => w.id === id)) stopWatch(id);
	}
	const ws = workspaces.find((w) => w.id === workspaceId);
	if (!ws) return alreadyReady;

	let rootIno: number;
	try {
		rootIno = statSync(ws.worktreePath).ino;
	} catch {
		stopWatch(workspaceId);
		return startupFallback;
	}
	const existing = entries.get(workspaceId);
	if (existing && existing.rootIno === rootIno) {
		if (!prewarm) existing.prewarmOnly = false;
		else if (existing.prewarmOnly) {
			entries.delete(workspaceId);
			entries.set(workspaceId, existing);
		}
		return existing.readySettled ? alreadyReady : existing.ready;
	}
	const replacesRealWatch = existing !== undefined && !existing.prewarmOnly;
	if (existing) stopWatch(workspaceId);

	const coalescer = createCoalescer({
		quietMs: QUIET_MS,
		maxWaitMs: MAX_WAIT_MS,
		maxPaths: MAX_PATHS,
		onFlush: ({ paths, truncated, skillChange }) => {
			deliver("fsChanged", workspaceId, () =>
				publish?.({ workspaceId, paths, truncated, skillChange }),
			);
		},
	});

	try {
		const watcher = watch(ws.worktreePath, { recursive: true }, (_event, filename) => {
			const rel = typeof filename === "string" ? filename.replaceAll("\\", "/") : null;
			if (rel === null || isRepoMetaPath(rel)) scheduleRepoMeta(workspaceId, watcher);
			if (rel !== null && isIgnoredPath(rel)) return;
			const skillChange: WorkspaceSkillChange =
				rel === null
					? "unknown"
					: isSkillPath === null
						? "unknown"
						: isSkillPath(rel)
							? "detected"
							: "none";
			coalescer.add(rel, skillChange);
		});
		watcher.on("error", () => {
			log.warn(`worktree watcher failed for workspace ${workspaceId}`);
			stopWatch(workspaceId);
		});
		let resolveReady: (result: WorkspaceWatchReadyResult) => void = () => {};
		const ready = new Promise<WorkspaceWatchReadyResult>((resolve) => {
			resolveReady = resolve;
		});
		const entry: WatchEntry = {
			watcher,
			coalescer,
			rootIno,
			nudgeTimer: null,
			ready,
			resolveReady,
			readySettled: false,
			prewarmOnly: prewarm && !replacesRealWatch,
			metaTimer: null,
			metaWatcher: null,
			commonWatcher: null,
			remoteWatcher: null,
			remoteWatchDir: null,
			remoteWatchRef: null,
			configRetryTimer: null,
		};
		entries.set(workspaceId, entry);
		publishWatchStarted?.(workspaceId);
		if (entry.prewarmOnly) evictExcessPrewarmOnlyWatches();
		entry.nudgeTimer = setTimeout(() => {
			if (entries.get(workspaceId) !== entry) return;
			entry.nudgeTimer = null;
			deliver("fsChanged", workspaceId, () =>
				publish?.({ workspaceId, paths: [], truncated: true, skillChange: "unknown" }),
			);
			settleReady(entry);
		}, STARTUP_NUDGE_MS);
		const gitDir = resolveExternalGitDir(ws.worktreePath);
		const commonDir = gitDir ? sharedGitDir(gitDir) : null;

		if (gitDir) {
			entry.metaWatcher = watchGitDir(workspaceId, gitDir, watcher, () => {
				if (commonDir) syncRemoteRefWatch(workspaceId, watcher, gitDir, commonDir);
			});
		}

		if (gitDir && commonDir) {
			try {
				const commonWatcher = watch(commonDir, { recursive: false }, (_event, changed) => {
					const name = changed?.toString();

					if (name == null || name === "config" || name === "config.lock") {
						syncRemoteRefWatch(workspaceId, watcher, gitDir, commonDir);

						if (!entry.remoteWatcher) {
							if (entry.configRetryTimer) clearTimeout(entry.configRetryTimer);
							entry.configRetryTimer = setTimeout(() => {
								entry.configRetryTimer = null;
								syncRemoteRefWatch(workspaceId, watcher, gitDir, commonDir);
							}, REPO_META_DEBOUNCE_MS);
						}
					}

					if (name == null || name === "config" || name === "packed-refs") {
						scheduleRepoMeta(workspaceId, watcher);
					}
				});

				commonWatcher.on("error", () => {
					commonWatcher.close();
					if (entry.commonWatcher === commonWatcher) entry.commonWatcher = null;
				});
				entry.commonWatcher = commonWatcher;
			} catch {
				log.warn("could not watch shared git metadata");
			}

			syncRemoteRefWatch(workspaceId, watcher, gitDir, commonDir);
		}

		return ready;
	} catch {
		stopWatch(workspaceId);
		coalescer.dispose();
		log.warn(`could not watch worktree for workspace ${workspaceId}`);
		return startupFallback;
	}
}

export function stopWatch(workspaceId: string): void {
	const entry = entries.get(workspaceId);
	if (!entry) return;
	entries.delete(workspaceId);
	if (entry.nudgeTimer) clearTimeout(entry.nudgeTimer);
	settleReady(entry);
	if (entry.metaTimer) clearTimeout(entry.metaTimer);
	entry.metaWatcher?.close();
	entry.commonWatcher?.close();
	entry.remoteWatcher?.close();
	if (entry.configRetryTimer) clearTimeout(entry.configRetryTimer);
	entry.coalescer.dispose();
	entry.watcher.close();
}

export function stopAllWatches(): void {
	for (const id of [...entries.keys()]) stopWatch(id);
}
