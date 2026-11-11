import { type Dirent, type FSWatcher, realpathSync, type WatchListener, watch } from "node:fs";
import { lstat, readdir, stat } from "node:fs/promises";
import { join } from "node:path";

export type TreeWatcher = { ready: Promise<void>; close: () => void; recheck: () => void };

export type TreeWatchOptions = {
	onEvent: (relPath: string | null) => void;
	onMissed: (relPath: string) => void;
	onError: () => void;
	skipDir: (relPath: string) => boolean;
	ignoredDirs: (relPaths: string[]) => Promise<ReadonlySet<string>>;
};

const LIST_BATCH = 64;
const CLOSE_BATCH = 256;
const ENOSPC_BATCHES = 4;
const VANISHED_CODES = new Set(["ENOENT", "ENOTDIR", "EACCES", "EPERM"]);
export const NOTHING_IGNORED: ReadonlySet<string> = new Set();

type Tree = {
	root: string;
	prefix: string;
	dirs: Map<string, FSWatcher>;
	reopen: (rel: string) => void;
};

const live = new Set<Tree>();
const closing: Tree[] = [];
const allTrees = [closing, live] as const;
let closeQueued = false;

function relativeTo(tree: Tree, path: string): string | null {
	if (path === tree.root) return "";
	return path.startsWith(tree.prefix) ? path.slice(tree.prefix.length) : null;
}

function closeSomeWaiting(): void {
	let left = CLOSE_BATCH;
	for (const tree of closing) {
		for (const [rel, watcher] of tree.dirs) {
			if (left === 0) break;
			left -= 1;
			watcher.close();
			tree.dirs.delete(rel);
		}
	}
	for (let index = closing.length - 1; index >= 0; index--) {
		if (closing[index]?.dirs.size === 0) closing.splice(index, 1);
	}
}

function queueClosing(): void {
	if (closeQueued || closing.length === 0) return;
	closeQueued = true;
	setImmediate(() => {
		closeQueued = false;
		closeSomeWaiting();
		queueClosing();
	});
}

function watchWithin(path: string, listener: WatchListener<string>): FSWatcher {
	for (let batch = 0; ; batch++) {
		try {
			return watch(path, { recursive: false }, listener);
		} catch (error) {
			const full = (error as NodeJS.ErrnoException).code === "ENOSPC";
			if (!full || closing.length === 0 || batch === ENOSPC_BATCHES) throw error;
			closeSomeWaiting();
		}
	}
}

function openWatch(path: string, listener: WatchListener<string>, owner: Tree): FSWatcher {
	const reopen: [Tree, string][] = [];
	for (const trees of allTrees) {
		for (const tree of trees) {
			const rel = tree === owner ? null : relativeTo(tree, path);
			const watcher = rel === null ? undefined : tree.dirs.get(rel);
			if (rel === null || !watcher) continue;
			watcher.close();
			tree.dirs.delete(rel);
			if (trees === live) reopen.push([tree, rel]);
		}
	}
	try {
		return watchWithin(path, listener);
	} finally {
		for (const [tree, rel] of reopen) tree.reopen(rel);
	}
}

function isVanished(error: unknown): boolean {
	return VANISHED_CODES.has((error as NodeJS.ErrnoException).code ?? "");
}

async function isDirectory(path: string, followLink: boolean): Promise<boolean> {
	try {
		return (await (followLink ? stat(path) : lstat(path))).isDirectory();
	} catch {
		return false;
	}
}

function parentOf(rel: string): string {
	const end = rel.lastIndexOf("/");
	return end < 0 ? "" : rel.slice(0, end);
}

function underAny(paths: ReadonlySet<string>, rel: string): boolean {
	for (let end = rel.lastIndexOf("/"); end > 0; end = rel.lastIndexOf("/", end - 1)) {
		if (paths.has(rel.slice(0, end))) return true;
	}
	return false;
}

export function watchTree(root: string, options: TreeWatchOptions): TreeWatcher {
	const dirs = new Map<string, FSWatcher>();
	const children = new Map<string, Set<string>>();
	const nestedRepos = new Set<string>();
	const pruned = new Set<string>();
	const changed = new Set<string>();
	const relist = new Set<string>();
	let recheckQueued = false;
	let flushing = false;
	let closed = false;

	const realRoot = realpathSync(root);
	const abs = (rel: string) => (rel === "" ? realRoot : join(realRoot, rel));
	const childPath = (dir: string, name: string) => (dir === "" ? name : `${dir}/${name}`);
	const tree: Tree = { root: realRoot, prefix: join(realRoot, "/"), dirs, reopen };

	function close(): void {
		if (closed) return;
		closed = true;
		live.delete(tree);
		closing.push(tree);
		children.clear();
		queueClosing();
	}

	function fail(): void {
		if (closed) return;
		close();
		options.onError();
	}

	const guard = (work: Promise<void>): Promise<void> => work.catch(fail);
	const insideNestedRepo = (rel: string) => underAny(nestedRepos, rel);

	function link(rel: string): void {
		const parent = parentOf(rel);
		const known = children.get(parent);
		if (known) known.add(rel);
		else children.set(parent, new Set([rel]));
	}

	function prune(rel: string): void {
		pruned.add(rel);
		link(rel);
	}

	function drop(rel: string): void {
		children.get(parentOf(rel))?.delete(rel);
		const stack = [rel];
		for (let path = stack.pop(); path !== undefined; path = stack.pop()) {
			dirs.get(path)?.close();
			dirs.delete(path);
			pruned.delete(path);
			nestedRepos.delete(path);
			for (const child of children.get(path) ?? []) stack.push(child);
			children.delete(path);
		}
	}

	function listenerFor(rel: string): WatchListener<string> {
		return (event, filename) => {
			if (closed) return;
			if (typeof filename !== "string") {
				options.onEvent(null);
				return;
			}
			const path = childPath(rel, filename);
			options.onEvent(path);
			if (filename === ".git" && rel !== "") nestedRepos.add(rel);
			if (filename === ".gitignore") recheckQueued = true;
			else if (event === "rename" && (dirs.has(path) || !options.skipDir(path))) changed.add(path);
			else return;
			schedule();
		};
	}

	function reopen(rel: string): void {
		try {
			const watcher = watchWithin(abs(rel), listenerFor(rel));
			watcher.on("error", fail);
			dirs.set(rel, watcher);
			options.onMissed(rel);
			relist.add(rel);
			schedule();
		} catch (error) {
			if (!isVanished(error)) fail();
		}
	}

	function watchDir(rel: string): void {
		const watcher = openWatch(abs(rel), listenerFor(rel), tree);
		watcher.on("error", fail);
		dirs.set(rel, watcher);
		if (rel !== "") link(rel);
		pruned.delete(rel);
	}

	async function track(rel: string): Promise<boolean> {
		const exists = await isDirectory(abs(rel), rel === "");
		if (closed) return false;
		if (!exists) {
			drop(rel);
			return false;
		}
		if (dirs.has(rel)) return true;
		try {
			watchDir(rel);
			return true;
		} catch (error) {
			if (isVanished(error)) return false;
			throw error;
		}
	}

	async function list(rel: string): Promise<Dirent[]> {
		if (!(await track(rel))) return [];
		try {
			return await readdir(abs(rel), { withFileTypes: true });
		} catch {
			return [];
		}
	}

	async function walk(start: string[], announce: boolean): Promise<void> {
		let level = start;
		while (level.length > 0 && !closed) {
			const checked: string[] = [];
			const unchecked: string[] = [];
			for (let index = 0; index < level.length; index += LIST_BATCH) {
				const batch = level.slice(index, index + LIST_BATCH);
				const listings = await Promise.all(batch.map(list));
				if (closed) return;
				for (const [position, dir] of batch.entries()) {
					const entries = listings[position] ?? [];
					if (dir !== "" && entries.some((entry) => entry.name === ".git")) nestedRepos.add(dir);
					for (const entry of entries) {
						const path = childPath(dir, entry.name);
						if (announce) options.onEvent(path);
						if (!entry.isDirectory() || options.skipDir(path)) continue;
						(insideNestedRepo(path) ? unchecked : checked).push(path);
					}
				}
			}
			const ignored = checked.length === 0 ? NOTHING_IGNORED : await options.ignoredDirs(checked);
			for (const path of checked) {
				if (ignored.has(path)) prune(path);
			}
			level = [...unchecked, ...checked.filter((path) => !ignored.has(path))];
		}
	}

	async function relistReopened(): Promise<void> {
		const folders = [...relist];
		relist.clear();
		for (let index = 0; index < folders.length; index += LIST_BATCH) {
			const batch = folders.slice(index, index + LIST_BATCH);
			const listings = await Promise.all(batch.map(list));
			if (closed) return;
			for (const [position, dir] of batch.entries()) {
				for (const entry of listings[position] ?? []) {
					const path = childPath(dir, entry.name);
					if (!entry.isDirectory() || dirs.has(path) || pruned.has(path)) continue;
					if (!options.skipDir(path)) changed.add(path);
				}
			}
		}
	}

	async function flush(): Promise<void> {
		if (relist.size > 0) await relistReopened();
		if (closed) return;
		const paths = [...changed];
		changed.clear();
		const rechecking = recheckQueued;
		recheckQueued = false;
		const present = await Promise.all(paths.map((rel) => isDirectory(abs(rel), false)));
		if (closed) return;
		for (const rel of paths) drop(rel);
		const created = paths.filter((_, index) => present[index]);
		const candidates = rechecking ? [...created, ...pruned] : created;
		const checked = candidates.filter((rel) => !insideNestedRepo(rel));
		const ignored = checked.length === 0 ? NOTHING_IGNORED : await options.ignoredDirs(checked);
		if (closed) return;
		const start = new Set<string>();
		for (const rel of candidates) {
			if (ignored.has(rel)) {
				prune(rel);
			} else {
				pruned.delete(rel);
				start.add(rel);
			}
		}
		const tops = [...start].filter((rel) => !underAny(start, rel));
		await walk(tops, true);
	}

	function settle(): void {
		flushing = false;
		if (changed.size > 0 || recheckQueued || relist.size > 0) schedule();
	}

	function schedule(): void {
		if (flushing || closed) return;
		flushing = true;
		void guard(flush()).then(settle);
	}

	watchDir("");
	live.add(tree);
	flushing = true;
	const ready = guard(walk([""], false));
	void ready.then(settle);
	return {
		ready,
		close,
		recheck: () => {
			recheckQueued = true;
			schedule();
		},
	};
}
