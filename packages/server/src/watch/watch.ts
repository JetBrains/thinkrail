import { type FSWatcher, readdirSync, readFileSync, statSync, watch } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import type {
	WorkspaceFsChangedPayload,
	WorkspaceSkillChange,
	WorkspaceWatchReadyResult,
} from "@thinkrail/contracts";
import { logger } from "../log";
import { loadWorkspaces } from "../persistence";
import { type Coalescer, createCoalescer } from "./coalesce";
import { NOTHING_IGNORED, type TreeWatcher, watchTree } from "./tree";

const log = logger("watch");

const QUIET_MS = 300;
const MAX_WAIT_MS = 1000;
const MAX_PATHS = 100;
const STARTUP_NUDGE_MS = 750;
const MAX_PREWARM_ONLY_WATCHES = 8;

const IGNORED_SEGMENTS = new Set([".git", "node_modules"]);
const IGNORED_NAMES = new Set([".DS_Store"]);
const REPO_META_DEBOUNCE_MS = 300;
const WATCH_EACH_DIRECTORY = process.platform === "linux";
const STARTED = Promise.resolve();
const WATCHED_GIT_DIRS = new Set(["refs", "reftable", "info", "modules"]);
const SKIPPED_SUBMODULE_DIRS = new Set(["objects", "logs", "lfs", "hooks"]);

type WatchPublisher = (payload: WorkspaceFsChangedPayload) => void;
type SkillPathClassifier = (relativePath: string) => boolean;
type RepoMetaPublisher = (workspaceId: string) => void;
type WatchStartedPublisher = (workspaceId: string) => void;
type IgnoredPathsResolver = (
	worktreePath: string,
	paths: readonly string[],
) => Promise<ReadonlySet<string>>;

const ALREADY_READY: WorkspaceWatchReadyResult = { startupNudge: false };
const STARTUP_NUDGE: WorkspaceWatchReadyResult = { startupNudge: true };
const alreadyReady = Promise.resolve(ALREADY_READY);
const startupFallback = Promise.resolve(STARTUP_NUDGE);

let publish: WatchPublisher | null = null;
let publishRepoMeta: RepoMetaPublisher | null = null;
let publishWatchStarted: WatchStartedPublisher | null = null;
let isSkillPath: SkillPathClassifier | null = null;
let resolveIgnoredPaths: IgnoredPathsResolver | null = null;

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

export function setIgnoredPathsResolver(resolver: IgnoredPathsResolver | null): void {
	resolveIgnoredPaths = resolver;
}

function isRepoMetaPath(relPath: string): boolean {
	return relPath.split(/[\\/]/)[0] === ".git";
}

function isDirectory(path: string): boolean {
	try {
		return statSync(path).isDirectory();
	} catch {
		return false;
	}
}

function isGitMetaChange(dir: string, relPath: string): boolean {
	return !relPath.toLowerCase().endsWith(".lock") && !isDirectory(resolve(dir, relPath));
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

function watchGitDir(workspaceId: string, dir: string, rootWatcher: TreeWatcher): FSWatcher | null {
	try {
		const watcher = watch(dir, { recursive: false }, (_event, filename) => {
			if (typeof filename !== "string" || isGitMetaChange(dir, filename))
				scheduleRepoMeta(workspaceId, rootWatcher);
		});
		watcher.on("error", () => {
			log.warn(`git metadata watcher failed for workspace ${workspaceId}`);
			watcher.close();
			const entry = entries.get(workspaceId);
			if (entry) entry.metaWatchers = entry.metaWatchers.filter((w) => w !== watcher);
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
		log.warn(`${sink} publisher failed for workspace ${workspaceId}`, error);
	}
}

function scheduleRepoMeta(workspaceId: string, watcher: TreeWatcher): void {
	const entry = entries.get(workspaceId);
	if (entry && entry.watcher !== watcher) return;
	if (entry?.metaTimer) clearTimeout(entry.metaTimer);
	const timer = setTimeout(() => {
		const live = entries.get(workspaceId);
		if (!live || live.watcher !== watcher) return;
		live.metaTimer = null;
		live.watcher.recheck();
		syncRemoteRefWatch(workspaceId, live);
		deliver("repo-meta", workspaceId, () => publishRepoMeta?.(workspaceId));
	}, REPO_META_DEBOUNCE_MS);
	if (entry) entry.metaTimer = timer;
}

function resolveCommonGitDir(gitDir: string): string | null {
	try {
		const commonDir = resolve(gitDir, readFileSync(join(gitDir, "commondir"), "utf8").trim());
		return isDirectory(commonDir) ? commonDir : null;
	} catch {
		return null;
	}
}

function headBranch(gitDir: string): string | null {
	try {
		const head = readFileSync(join(gitDir, "HEAD"), "utf8").trim();
		return /^ref: refs\/heads\/(.+)$/.exec(head)?.[1] ?? null;
	} catch {
		return null;
	}
}

function subdirectories(dir: string): string[] {
	try {
		return readdirSync(dir, { withFileTypes: true })
			.filter((entry) => entry.isDirectory())
			.map((entry) => entry.name);
	} catch {
		return [];
	}
}

type RefWatchTarget = [dir: string, name: string | null];

function remoteRefTargets(gitDir: string, commonDir: string): RefWatchTarget[] {
	const packedRefs: RefWatchTarget = [commonDir, "packed-refs"];
	const refs = join(commonDir, "refs");
	const remotes = join(refs, "remotes");
	if (!isDirectory(remotes)) return [packedRefs, [refs, "remotes"]];
	const targets: RefWatchTarget[] = [packedRefs, [remotes, null]];
	const segments = headBranch(gitDir)?.split("/") ?? [];
	const leaf = segments.pop();
	if (leaf === undefined) return targets;
	for (const remote of subdirectories(remotes)) {
		let dir = join(remotes, remote);
		let name = leaf;
		for (const segment of segments) {
			if (!isDirectory(join(dir, segment))) {
				name = segment;
				break;
			}
			dir = join(dir, segment);
		}
		targets.push([dir, name]);
	}
	return targets;
}

function watchRefDir(
	workspaceId: string,
	rootWatcher: TreeWatcher,
	[dir, name]: RefWatchTarget,
): FSWatcher | null {
	try {
		const watcher = watch(dir, { recursive: false }, (_event, filename) => {
			if (name === null || typeof filename !== "string" || filename === name)
				scheduleRepoMeta(workspaceId, rootWatcher);
		});
		watcher.on("error", () => {
			watcher.close();
			const remoteRefs = entries.get(workspaceId)?.remoteRefs;
			if (remoteRefs) remoteRefs.watchers = remoteRefs.watchers.filter((w) => w !== watcher);
		});
		return watcher;
	} catch {
		return null;
	}
}

function syncRemoteRefWatch(workspaceId: string, entry: WatchEntry): void {
	const remoteRefs = entry.remoteRefs;
	if (!remoteRefs) return;
	for (const watcher of remoteRefs.watchers) watcher.close();
	remoteRefs.watchers = remoteRefTargets(remoteRefs.gitDir, remoteRefs.commonDir).flatMap(
		(target) => watchRefDir(workspaceId, entry.watcher, target) ?? [],
	);
}

export function isIgnoredPath(relPath: string): boolean {
	const segments = relPath.split(/[\\/]/);
	if (segments.some((s) => IGNORED_SEGMENTS.has(s))) return true;
	const name = segments[segments.length - 1];
	return name !== undefined && IGNORED_NAMES.has(name);
}

function isSkippedDir(relPath: string): boolean {
	const segments = relPath.split("/");
	if (segments.includes("node_modules")) return true;
	const git = segments.indexOf(".git");
	if (git !== 0 || segments.length === 1) return git > 0;
	if (!WATCHED_GIT_DIRS.has(segments[1] ?? "")) return true;
	return (
		segments[1] === "modules" && segments.some((segment) => SKIPPED_SUBMODULE_DIRS.has(segment))
	);
}

function ignoredWorktreeDirs(worktreePath: string, paths: string[]): Promise<ReadonlySet<string>> {
	const checked = paths.filter((path) => !isRepoMetaPath(path));
	if (!resolveIgnoredPaths || checked.length === 0) return Promise.resolve(NOTHING_IGNORED);
	return resolveIgnoredPaths(worktreePath, checked);
}

function watchRecursive(
	root: string,
	onEvent: (relPath: string | null) => void,
	onError: () => void,
): TreeWatcher {
	const watcher = watch(root, { recursive: true }, (_event, filename) => {
		onEvent(typeof filename === "string" ? filename.replaceAll("\\", "/") : null);
	});
	watcher.on("error", onError);
	return { ready: STARTED, close: () => watcher.close(), recheck: () => {} };
}

interface RemoteRefWatch {
	gitDir: string;
	commonDir: string;
	watchers: FSWatcher[];
}

interface WatchEntry {
	watcher: TreeWatcher;
	coalescer: Coalescer;
	rootIno: number;
	nudgeTimer: ReturnType<typeof setTimeout> | null;
	ready: Promise<WorkspaceWatchReadyResult>;
	resolveReady: (result: WorkspaceWatchReadyResult) => void;
	readySettled: boolean;
	prewarmOnly: boolean;
	remoteRefs: RemoteRefWatch | null;
	metaTimer: ReturnType<typeof setTimeout> | null;
	metaWatchers: FSWatcher[];
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
		const skillChangeOf = (rel: string): WorkspaceSkillChange =>
			isSkillPath === null ? "unknown" : isSkillPath(rel) ? "detected" : "none";
		const onEvent = (rel: string | null) => {
			if (rel === null || (isRepoMetaPath(rel) && isGitMetaChange(ws.worktreePath, rel)))
				scheduleRepoMeta(workspaceId, watcher);
			if (rel !== null && isIgnoredPath(rel)) return;
			coalescer.add(rel, rel === null ? "unknown" : skillChangeOf(rel));
		};
		const onMissed = (rel: string) => {
			if (isRepoMetaPath(rel)) scheduleRepoMeta(workspaceId, watcher);
			if (!isIgnoredPath(rel)) coalescer.add(null, skillChangeOf(rel));
		};
		const onError = () => {
			log.warn(`worktree watcher failed for workspace ${workspaceId}`);
			stopWatch(workspaceId);
		};
		const watcher = WATCH_EACH_DIRECTORY
			? watchTree(ws.worktreePath, {
					onEvent,
					onMissed,
					onError,
					skipDir: isSkippedDir,
					ignoredDirs: (paths) => ignoredWorktreeDirs(ws.worktreePath, paths),
				})
			: watchRecursive(ws.worktreePath, onEvent, onError);
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
			remoteRefs: null,
			metaTimer: null,
			metaWatchers: [],
		};
		entries.set(workspaceId, entry);
		publishWatchStarted?.(workspaceId);
		if (entry.prewarmOnly) evictExcessPrewarmOnlyWatches();
		void watcher.ready.then(() => {
			if (entries.get(workspaceId) !== entry) return;
			entry.nudgeTimer = setTimeout(() => {
				if (entries.get(workspaceId) !== entry) return;
				entry.nudgeTimer = null;
				deliver("fsChanged", workspaceId, () =>
					publish?.({ workspaceId, paths: [], truncated: true, skillChange: "unknown" }),
				);
				settleReady(entry);
			}, STARTUP_NUDGE_MS);
		});
		const gitDir = resolveExternalGitDir(ws.worktreePath);
		if (gitDir)
			entry.metaWatchers = [gitDir, join(gitDir, "logs")]
				.filter(isDirectory)
				.flatMap((dir) => watchGitDir(workspaceId, dir, watcher) ?? []);
		const commonDir = gitDir ? resolveCommonGitDir(gitDir) : null;
		if (gitDir && commonDir) {
			entry.remoteRefs = { gitDir, commonDir, watchers: [] };
			syncRemoteRefWatch(workspaceId, entry);
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
	for (const metaWatcher of entry.metaWatchers) metaWatcher.close();
	entry.coalescer.dispose();
	for (const watcher of entry.remoteRefs?.watchers ?? []) watcher.close();
	entry.watcher.close();
}

export function stopAllWatches(): void {
	for (const id of [...entries.keys()]) stopWatch(id);
}
