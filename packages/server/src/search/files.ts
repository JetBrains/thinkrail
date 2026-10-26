import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { gitAsyncStream, nonInteractiveGitEnv } from "../git";

export interface FileList {
	readonly paths: readonly string[];
	readonly truncated: boolean;
}

export interface IndexedFileList extends FileList {
	/** Lower-cased twin of `paths`, computed once so a keystroke never lower-cases the corpus again. */
	readonly lower: readonly string[];
}

export function indexFileList(list: FileList): IndexedFileList {
	return { ...list, lower: list.paths.map((path) => path.toLowerCase()) };
}

export const FILE_LIST_LIMITS = {
	maxFiles: 100_000,
	maxBytes: 16 * 1024 * 1024,
	walkMaxFiles: 20_000,
	ttlMs: 60_000,
	gitTimeoutMs: 15_000,
	maxRoots: 8,
} as const;

const WALK_IGNORED = new Set([".git", "node_modules", ".hg", ".svn"]);

const decoder = new TextDecoder();

export function parseNulList(
	chunks: AsyncIterable<Uint8Array> | Iterable<Uint8Array>,
	limits: { maxFiles: number; maxBytes: number } = FILE_LIST_LIMITS,
): Promise<FileList> {
	return (async () => {
		const paths: string[] = [];
		let pending: Uint8Array[] = [];
		let pendingBytes = 0;
		let seenBytes = 0;
		let truncated = false;
		const flush = () => {
			if (pendingBytes === 0) return;
			const joined = new Uint8Array(pendingBytes);
			let offset = 0;
			for (const part of pending) {
				joined.set(part, offset);
				offset += part.byteLength;
			}
			paths.push(decoder.decode(joined));
			pending = [];
			pendingBytes = 0;
		};
		outer: for await (const chunk of chunks) {
			seenBytes += chunk.byteLength;
			if (seenBytes > limits.maxBytes) {
				truncated = true;
				break;
			}
			let start = 0;
			for (let index = 0; index < chunk.byteLength; index += 1) {
				if (chunk[index] !== 0) continue;
				const part = chunk.subarray(start, index);
				pending.push(part);
				pendingBytes += part.byteLength;
				flush();
				start = index + 1;
				if (paths.length >= limits.maxFiles) {
					truncated = true;
					break outer;
				}
			}
			if (start < chunk.byteLength) {
				const rest = chunk.subarray(start);
				pending.push(rest);
				pendingBytes += rest.byteLength;
			}
		}
		if (!truncated) flush();
		return { paths, truncated };
	})();
}

async function gitFileList(root: string): Promise<FileList | null> {
	const run = gitAsyncStream(root, ["ls-files", "-co", "--exclude-standard", "-z"], {
		env: { ...nonInteractiveGitEnv(), LC_ALL: "C" },
		timeoutMs: FILE_LIST_LIMITS.gitTimeoutMs,
	});
	const reader = run.stdout.getReader();
	const chunks = (async function* () {
		while (true) {
			const next = await reader.read();
			if (next.done) return;
			yield next.value;
		}
	})();
	let list: FileList;
	try {
		list = await parseNulList(chunks);
	} catch {
		await run.exited;
		return null;
	}
	if (list.truncated) void reader.cancel().catch(() => {});
	const exit = await run.exited;
	if (!exit.ok && !list.truncated) return null;
	return list;
}

async function walkFileList(root: string): Promise<FileList> {
	const paths: string[] = [];
	let truncated = false;
	const queue: string[] = [""];
	while (queue.length > 0 && !truncated) {
		const rel = queue.shift() ?? "";
		let entries: import("node:fs").Dirent[];
		try {
			entries = await readdir(join(root, rel), { withFileTypes: true });
		} catch {
			continue;
		}
		for (const entry of entries) {
			if (WALK_IGNORED.has(entry.name)) continue;
			const path = rel ? `${rel}/${entry.name}` : entry.name;
			if (entry.isDirectory()) queue.push(path);
			else if (entry.isFile()) {
				paths.push(path);
				if (paths.length >= FILE_LIST_LIMITS.walkMaxFiles) {
					truncated = true;
					break;
				}
			}
		}
	}
	return { paths, truncated };
}

function isHiddenFromSearch(path: string): boolean {
	return path.split("/").some((segment) => WALK_IGNORED.has(segment));
}

export async function listRootFiles(root: string): Promise<FileList> {
	const list = (await gitFileList(root)) ?? (await walkFileList(root));
	return {
		paths: list.paths.filter((path) => !isHiddenFromSearch(path)),
		truncated: list.truncated,
	};
}

export class FileListCache {
	private readonly lists = new Map<string, { at: number; list: IndexedFileList }>();
	private readonly loading = new Map<string, Promise<IndexedFileList>>();

	constructor(
		private readonly loader: (root: string) => Promise<FileList> = listRootFiles,
		private readonly now: () => number = Date.now,
	) {}

	/** The cached list, stale or fresh; a stale one is served while its reload runs. `null` only before the first load. */
	peek(root: string): IndexedFileList | null {
		const cached = this.lists.get(root);
		if (!cached) return null;
		this.lists.delete(root);
		this.lists.set(root, cached);
		if (this.now() - cached.at > FILE_LIST_LIMITS.ttlMs) void this.load(root);
		return cached.list;
	}

	/** A reload is in flight: `peek` still answers, but the answer is about to change. */
	reloading(root: string): boolean {
		return this.loading.has(root);
	}

	load(root: string): Promise<IndexedFileList> {
		const inFlight = this.loading.get(root);
		if (inFlight) return inFlight;
		const promise = this.loader(root)
			.then((list) => indexFileList(list))
			.catch((): IndexedFileList | null => null)
			.then((loaded) => {
				this.loading.delete(root);
				const kept = this.lists.get(root);
				if (loaded === null && kept) return kept.list;
				const list = loaded ?? indexFileList({ paths: [], truncated: false });
				this.lists.delete(root);
				this.lists.set(root, { at: this.now(), list });
				while (this.lists.size > FILE_LIST_LIMITS.maxRoots) {
					const oldest = this.lists.keys().next().value;
					if (oldest === undefined) break;
					this.lists.delete(oldest);
				}
				return list;
			});
		this.loading.set(root, promise);
		return promise;
	}

	/** Marks a root stale: the old list keeps answering until the reload lands. */
	invalidate(root: string): void {
		const cached = this.lists.get(root);
		if (cached) this.lists.set(root, { at: Number.NEGATIVE_INFINITY, list: cached.list });
	}
}
