import type { Dirent } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { foldMatchText } from "@thinkrail/contracts";
import { gitAsyncStream, nonInteractiveGitEnv } from "../git";
import { logger } from "../log";

const log = logger("search");

export interface FileList {
	readonly paths: readonly string[];
	readonly truncated: boolean;
}

export interface IndexedFileList extends FileList {
	readonly folded: readonly string[];
}

export function indexFileList(list: FileList): IndexedFileList {
	return { ...list, folded: list.paths.map((path) => foldMatchText(path)) };
}

const EMPTY_LIST: IndexedFileList = { paths: [], folded: [], truncated: false };

export const FILE_LIST_LIMITS = {
	maxFiles: 128_000,
	maxBytes: 16 * 1024 * 1024,
	walkMaxFiles: 20_000,
	ttlMs: 60_000,
	retryMs: 5_000,
	gitTimeoutMs: 15_000,
	maxRoots: 8,
	maxCachedPaths: 256_000,
} as const;

const HIDDEN_DIRECTORIES = new Set([".git", "node_modules", ".hg", ".svn"]);
const UNTRACKED_EXCLUDES = [...HIDDEN_DIRECTORIES]
	.filter((name) => name !== ".git")
	.flatMap((name) => ["-x", name]);

export class FileListUnavailable extends Error {
	override readonly name = "FileListUnavailable";
}

const decoder = new TextDecoder();

function isHiddenFromSearch(path: string): boolean {
	return path.split("/").some((segment) => HIDDEN_DIRECTORIES.has(segment));
}

export function parseNulList(
	chunks: AsyncIterable<Uint8Array> | Iterable<Uint8Array>,
	limits: { maxFiles: number; maxBytes: number } = FILE_LIST_LIMITS,
): Promise<FileList> {
	return (async () => {
		const paths: string[] = [];
		const seen = new Set<string>();
		let pending: Uint8Array[] = [];
		let pendingBytes = 0;
		let seenBytes = 0;
		let truncated = false;
		const flush = (): boolean => {
			const joined = new Uint8Array(pendingBytes);
			let offset = 0;
			for (const part of pending) {
				joined.set(part, offset);
				offset += part.byteLength;
			}
			pending = [];
			pendingBytes = 0;
			const path = decoder.decode(joined);
			if (seen.has(path) || isHiddenFromSearch(path)) return true;
			if (paths.length >= limits.maxFiles) return false;
			seen.add(path);
			paths.push(path);
			return true;
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
				start = index + 1;
				if (!flush()) {
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
		if (!truncated && pendingBytes > 0 && !flush()) truncated = true;
		return { paths, truncated };
	})();
}

async function gitFileList(root: string): Promise<FileList> {
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
	throw new FileListUnavailable(exit.timedOut ? "git ls-files timed out" : "git ls-files failed");
}

type DirEntry = Pick<Dirent, "name" | "isDirectory" | "isFile">;
type ReadDir = (path: string) => Promise<DirEntry[]>;

const readDirEntries: ReadDir = (path) => readdir(path, { withFileTypes: true });
const SKIPPED_DIRECTORY_CODES = new Set(["ENOENT", "ENOTDIR", "EACCES", "EPERM"]);

export async function walkFileList(
	root: string,
	read: ReadDir = readDirEntries,
): Promise<FileList> {
	const paths: string[] = [];
	const queue = [""];
	for (let next = 0; next < queue.length; next += 1) {
		const rel = queue[next] ?? "";
		let entries: DirEntry[];
		try {
			entries = await read(join(root, rel));
		} catch (error) {
			const code = (error as NodeJS.ErrnoException).code ?? "";
			if (rel !== "" && SKIPPED_DIRECTORY_CODES.has(code)) continue;
			throw new FileListUnavailable(`the folder could not be walked (${code || "unknown"})`);
		}
		for (const entry of entries) {
			if (HIDDEN_DIRECTORIES.has(entry.name)) continue;
			const path = rel ? `${rel}/${entry.name}` : entry.name;
			if (entry.isDirectory()) queue.push(path);
			else if (entry.isFile()) {
				if (paths.length >= FILE_LIST_LIMITS.walkMaxFiles) return { paths, truncated: true };
				paths.push(path);
			}
		}
	}
	return { paths, truncated: false };
}

export function listRootFiles(root: string, git: boolean): Promise<FileList> {
	return git ? gitFileList(root) : walkFileList(root);
}

export type FileListState = "ready" | "refreshing" | "failed";

export interface FileListView {
	readonly list: IndexedFileList;
	readonly state: FileListState;
}

interface CachedList {
	readonly at: number;
	readonly list: IndexedFileList;
}

export class FileListCache {
	private readonly lists = new Map<string, CachedList>();
	private readonly loading = new Map<string, Promise<void>>();
	private readonly overtaken = new Set<string>();
	private readonly failedAt = new Map<string, number>();
	private readonly loader: (root: string, git: boolean) => Promise<FileList>;
	private readonly now: () => number;

	constructor(
		loader: (root: string, git: boolean) => Promise<FileList> = listRootFiles,
		now: () => number = Date.now,
	) {
		this.loader = loader;
		this.now = now;
	}

	refresh(root: string, git: boolean): Promise<void> {
		if (this.due(root)) return this.load(root, git);
		return this.loading.get(root) ?? Promise.resolve();
	}

	peek(root: string, git: boolean): FileListView | null {
		void this.refresh(root, git);
		const cached = this.lists.get(root);
		const failed = this.failedAt.has(root);
		if (!cached) return failed ? { list: EMPTY_LIST, state: "failed" } : null;
		this.lists.delete(root);
		this.lists.set(root, cached);
		const state = failed ? "failed" : this.loading.has(root) ? "refreshing" : "ready";
		return { list: cached.list, state };
	}

	load(root: string, git: boolean): Promise<void> {
		const inFlight = this.loading.get(root);
		if (inFlight) return inFlight;
		const promise = this.loader(root, git)
			.then(
				(list) => this.install(root, indexFileList(list)),
				(error: unknown) => this.fail(root, error),
			)
			.finally(() => this.loading.delete(root));
		this.loading.set(root, promise);
		return promise;
	}

	invalidate(root: string): void {
		if (this.loading.has(root)) this.overtaken.add(root);
		const cached = this.lists.get(root);
		if (cached) this.lists.set(root, { ...cached, at: Number.NEGATIVE_INFINITY });
	}

	private due(root: string): boolean {
		if (this.loading.has(root)) return false;
		const now = this.now();
		const failedAt = this.failedAt.get(root);
		if (failedAt !== undefined) return now - failedAt >= FILE_LIST_LIMITS.retryMs;
		const cached = this.lists.get(root);
		return !cached || now - cached.at > FILE_LIST_LIMITS.ttlMs;
	}

	private install(root: string, list: IndexedFileList): void {
		const overtaken = this.overtaken.delete(root);
		this.failedAt.delete(root);
		this.lists.delete(root);
		this.lists.set(root, { at: overtaken ? Number.NEGATIVE_INFINITY : this.now(), list });
		this.evict(root);
	}

	private fail(root: string, error: unknown): void {
		this.overtaken.delete(root);
		if (!this.failedAt.has(root)) log.warn("file list load failed", error);
		this.failedAt.set(root, this.now());
		if (this.failedAt.size > FILE_LIST_LIMITS.maxRoots * 4) {
			const oldest = this.failedAt.keys().next().value;
			if (oldest !== undefined && oldest !== root) this.failedAt.delete(oldest);
		}
	}

	private evict(keep: string): void {
		let paths = 0;
		for (const cached of this.lists.values()) paths += cached.list.paths.length;
		for (const [root, cached] of this.lists) {
			if (
				this.lists.size <= FILE_LIST_LIMITS.maxRoots &&
				paths <= FILE_LIST_LIMITS.maxCachedPaths
			) {
				return;
			}
			if (root === keep) continue;
			this.lists.delete(root);
			paths -= cached.list.paths.length;
		}
	}
}
