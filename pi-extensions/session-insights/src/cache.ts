import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { scanFile, sliceYielder } from "./lines.ts";
import { isRecord } from "./totals.ts";

export const CACHE_VERSION = 1;
const CACHE_FILE = "summaries.v1.jsonl";
const SLICE_MS = 8;

export interface CacheDocument {
	cacheVersion: number;
	parserVersion: number;
	files: Readonly<Record<string, unknown>>;
}

export interface SummaryCache {
	load(): Promise<unknown>;
	/** Writes nothing once `signal` is aborted, even when it was aborted part-way. */
	save(document: CacheDocument, signal?: AbortSignal): Promise<void>;
}

export function fileSummaryCache(dir: string): SummaryCache {
	const file = join(dir, CACHE_FILE);
	return {
		async load() {
			try {
				const { size } = await stat(file);
				let header: unknown;
				const files = new Map<string, unknown>();
				const keep = (line: unknown) => {
					if (header === undefined) header = line;
					else if (Array.isArray(line) && line.length === 2 && typeof line[0] === "string")
						files.set(line[0], line[1]);
				};
				const { tail } = await scanFile(file, 0, size, keep, sliceYielder(SLICE_MS));
				if (tail) keep(tail.entry);
				return isRecord(header) ? { ...header, files: Object.fromEntries(files) } : null;
			} catch {
				return null;
			}
		},
		async save(document, signal) {
			const yielder = sliceYielder(SLICE_MS, undefined, signal);
			const lines = [
				JSON.stringify({
					cacheVersion: document.cacheVersion,
					parserVersion: document.parserVersion,
				}),
			];
			for (const record of Object.entries(document.files)) {
				lines.push(JSON.stringify(record));
				if (yielder.due()) await yielder.pause();
			}
			signal?.throwIfAborted();
			await mkdir(dir, { recursive: true });
			const temporary = `${file}.${randomUUID()}.tmp`;
			try {
				await writeFile(temporary, `${lines.join("\n")}\n`);
				signal?.throwIfAborted();
				await rename(temporary, file);
			} catch (error) {
				await rm(temporary, { force: true });
				throw error;
			}
		},
	};
}
