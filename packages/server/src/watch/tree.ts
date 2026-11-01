import { type Dirent, type FSWatcher, watch } from "node:fs";
import { lstat, readdir, stat } from "node:fs/promises";
import { join } from "node:path";

export type TreeWatcher = { ready: Promise<void>; close: () => void; recheck: () => void };

export type TreeWatchOptions = {
	onEvent: (relPath: string | null) => void;
	onError: () => void;
	skipDir: (relPath: string) => boolean;
	ignoredDirs: (relPaths: string[]) => Promise<ReadonlySet<string>>;
};

const LIST_BATCH = 64;
const VANISHED_CODES = new Set(["ENOENT", "ENOTDIR", "EACCES", "EPERM"]);
const NOTHING_IGNORED: ReadonlySet<string> = new Set();

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

function underAny(paths: ReadonlySet<string>, rel: string): boolean {
	for (let end = rel.lastIndexOf("/"); end > 0; end = rel.lastIndexOf("/", end - 1)) {
		if (paths.has(rel.slice(0, end))) return true;
	}
	return false;
}

export function watchTree(root: string, options: TreeWatchOptions): TreeWatcher {
	const dirs = new Map<string, FSWatcher>();
	const nestedRepos = new Set<string>();
	const pruned = new Set<string>();
	const changed = new Set<string>();
	let recheckQueued = false;
	let flushing = false;
	let closed = false;

	const abs = (rel: string) => (rel === "" ? root : join(root, rel));
	const childPath = (dir: string, name: string) => (dir === "" ? name : `${dir}/${name}`);

	function close(): void {
		closed = true;
		for (const watcher of dirs.values()) watcher.close();
		dirs.clear();
	}

	function fail(): void {
		if (closed) return;
		close();
		options.onError();
	}

	const guard = (work: Promise<void>): Promise<void> => work.catch(fail);
	const insideNestedRepo = (rel: string) => underAny(nestedRepos, rel);

	function drop(rel: string): void {
		pruned.delete(rel);
		if (!dirs.has(rel)) return;
		const prefix = `${rel}/`;
		for (const [path, watcher] of dirs) {
			if (path !== rel && !path.startsWith(prefix)) continue;
			watcher.close();
			dirs.delete(path);
		}
		for (const known of [nestedRepos, pruned]) {
			for (const path of known) {
				if (path === rel || path.startsWith(prefix)) known.delete(path);
			}
		}
	}

	function watchDir(rel: string): void {
		const watcher = watch(abs(rel), { recursive: false }, (event, filename) => {
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
		});
		watcher.on("error", fail);
		dirs.set(rel, watcher);
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
				if (ignored.has(path)) pruned.add(path);
			}
			level = [...unchecked, ...checked.filter((path) => !ignored.has(path))];
		}
	}

	async function flush(): Promise<void> {
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
				pruned.add(rel);
			} else {
				pruned.delete(rel);
				start.add(rel);
			}
		}
		const tops = [...start].filter((rel) => !underAny(start, rel));
		await walk(tops, true);
	}

	function schedule(): void {
		if (flushing || closed) return;
		flushing = true;
		void guard(flush()).then(() => {
			flushing = false;
			if (changed.size > 0 || recheckQueued) schedule();
		});
	}

	watchDir("");
	return {
		ready: guard(walk([""], false)),
		close,
		recheck: () => {
			recheckQueued = true;
			schedule();
		},
	};
}
