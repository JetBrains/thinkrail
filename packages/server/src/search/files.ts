import type { Dirent } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { foldMatchCase } from "@thinkrail/contracts";
import { gitAsyncStream, nonInteractiveGitEnv } from "../git";
import { logger } from "../log";

const log = logger("search");

export interface FileList {
	readonly paths: readonly string[];
	readonly truncated: boolean;
}

export interface IndexedFileList extends FileList {
	readonly folded: readonly string[];
	readonly failed?: boolean;
}

export function indexFileList(list: FileList): IndexedFileList {
	return { ...list, folded: list.paths.map((path) => foldMatchCase(path)) };
}

const FAILED_LIST: IndexedFileList = { paths: [], folded: [], truncated: false, failed: true };

export const FILE_LIST_LIMITS = {
	maxFiles: 100_000,
	maxBytes: 16 * 1024 * 1024,
	walkMaxFiles: 20_000,
	ttlMs: 60_000,
	gitTimeoutMs: 15_000,
	maxRoots: 8,
} as const;

export const SEARCH_HIDDEN_DIRS = ["node_modules", ".hg", ".svn"] as const;
const WALK_IGNORED = new Set<string>([".git", ...SEARCH_HIDDEN_DIRS]);
const UNTRACKED_EXCLUDES = SEARCH_HIDDEN_DIRS.flatMap((name) => ["-x", name]);
const TRANSIENT_MESSAGE =
	/too many open files|resource temporarily unavailable|cannot allocate memory/i;
const TRANSIENT_CODES = new Set(["EMFILE", "ENFILE", "EAGAIN", "ENOMEM"]);

export function isTransientListFailure(failure: {
	readonly timedOut?: boolean | undefined;
	readonly code?: string | undefined;
	readonly message?: string | undefined;
}): boolean {
	return (
		failure.timedOut === true ||
		TRANSIENT_CODES.has(failure.code ?? "") ||
		TRANSIENT_MESSAGE.test(failure.message ?? "")
	);
}

export class FileListUnavailable extends Error {
	override readonly name = "FileListUnavailable";
}

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
	const run = gitAsyncStream(
		root,
		["ls-files", "-co", "--exclude-standard", ...UNTRACKED_EXCLUDES, "-z"],
		{
			env: { ...nonInteractiveGitEnv(), LC_ALL: "C" },
			timeoutMs: FILE_LIST_LIMITS.gitTimeoutMs,
		},
	);
	const reader = run.stdout.getReader();
	const chunks = (async function* () {
		while (true) {
			const next = await reader.read();
			if (next.done) return;
			yield next.value;
		}
	})();
	let list: FileList | null = null;
	try {
		list = await parseNulList(chunks);
	} catch {
		list = null;
	}
	if (list?.truncated) void reader.cancel().catch(() => {});
	const exit = await run.exited;
	if (list && (exit.ok || list.truncated)) return list;
	if (isTransientListFailure({ timedOut: exit.timedOut, message: exit.err })) {
		throw new FileListUnavailable(exit.timedOut ? "git ls-files timed out" : "git ls-files failed");
	}
	return null;
}

type ReadDir = (path: string) => Promise<Dirent[]>;

const readDirEntries: ReadDir = (path) => readdir(path, { withFileTypes: true });

export async function walkFileList(
	root: string,
	read: ReadDir = readDirEntries,
): Promise<FileList> {
	const paths: string[] = [];
	let truncated = false;
	const queue: string[] = [""];
	while (queue.length > 0 && !truncated) {
		const rel = queue.shift() ?? "";
		let entries: Dirent[];
		try {
			entries = await read(join(root, rel));
		} catch (error) {
			const failure = error as NodeJS.ErrnoException;
			if (isTransientListFailure({ code: failure.code, message: failure.message })) throw error;
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

export function isHiddenFromSearch(path: string): boolean {
	return path.split("/").some((segment) => WALK_IGNORED.has(segment));
}

export async function listRootFiles(root: string, git: boolean): Promise<FileList> {
	const list = (git ? await gitFileList(root) : null) ?? (await walkFileList(root));
	const seen = new Set<string>();
	const paths: string[] = [];
	for (const path of list.paths) {
		if (seen.has(path) || isHiddenFromSearch(path)) continue;
		seen.add(path);
		paths.push(path);
	}
	return { paths, truncated: list.truncated };
}

export class FileListCache {
	private readonly lists = new Map<string, { at: number; list: IndexedFileList; git: boolean }>();
	private readonly loading = new Map<string, Promise<IndexedFileList>>();
	private readonly overtaken = new Set<string>();

	constructor(
		private readonly loader: (root: string, git: boolean) => Promise<FileList> = listRootFiles,
		private readonly now: () => number = Date.now,
	) {}

	peek(root: string): IndexedFileList | null {
		const cached = this.lists.get(root);
		if (!cached) return null;
		this.lists.delete(root);
		this.lists.set(root, cached);
		if (this.now() - cached.at > FILE_LIST_LIMITS.ttlMs) void this.load(root, cached.git);
		return cached.list;
	}

	reloading(root: string): boolean {
		return this.loading.has(root);
	}

	load(root: string, git: boolean): Promise<IndexedFileList> {
		const inFlight = this.loading.get(root);
		if (inFlight) return inFlight;
		const promise = this.loader(root, git)
			.then((list) => indexFileList(list))
			.catch((error: unknown): IndexedFileList | null => {
				log.warn("file list load failed", error);
				return null;
			})
			.then((loaded) => {
				this.loading.delete(root);
				const overtaken = this.overtaken.delete(root);
				const kept = this.lists.get(root);
				if (loaded === null && kept) return kept.list;
				const list = loaded ?? FAILED_LIST;
				const stale = overtaken || loaded === null;
				this.lists.delete(root);
				this.lists.set(root, { at: stale ? Number.NEGATIVE_INFINITY : this.now(), list, git });
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

	invalidate(root: string): void {
		if (this.loading.has(root)) this.overtaken.add(root);
		const cached = this.lists.get(root);
		if (cached) this.lists.set(root, { ...cached, at: Number.NEGATIVE_INFINITY });
	}
}
