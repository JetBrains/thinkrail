import { stat } from "node:fs/promises";
import { join } from "node:path";
import {
	TEXT_SEARCH_LIMITS,
	type TextSearchBatch,
	type TextSearchEnd,
	type TextSearchFile,
} from "@thinkrail/contracts";
import { gitAsyncStream, nonInteractiveGitEnv } from "../git";
import type { SearchRoot } from "./providers";

export interface TextQuery {
	query: string;
	caseSensitive: boolean;
	wholeWord: boolean;
}

export const TEXT_SEARCH_BUDGET = {
	gitTimeoutMs: 30_000,
	flushMs: 60,
	recordBytes: 64 * 1024,
	rangesPerLine: 50,
} as const;

export function textSearchArgs(root: SearchRoot, query: TextQuery): string[] {
	return [
		"grep",
		"--no-color",
		"-n",
		"-z",
		"-I",
		"--fixed-strings",
		...(query.caseSensitive ? [] : ["-i"]),
		...(query.wholeWord ? ["-w"] : []),
		...(root.git ? ["--untracked"] : ["--no-index"]),
		"--exclude-standard",
		"-e",
		query.query,
	];
}

const WORD = /[A-Za-z0-9_]/;

function isBoundary(text: string, index: number): boolean {
	return index < 0 || index >= text.length || !WORD.test(text.charAt(index));
}

export function matchRanges(text: string, query: TextQuery): [number, number][] {
	const hay = query.caseSensitive ? text : text.toLowerCase();
	const needle = query.caseSensitive ? query.query : query.query.toLowerCase();
	if (!needle || hay.length !== text.length) return [];
	const ranges: [number, number][] = [];
	let from = 0;
	while (ranges.length < TEXT_SEARCH_BUDGET.rangesPerLine) {
		const at = hay.indexOf(needle, from);
		if (at === -1) break;
		const end = at + needle.length;
		if (!query.wholeWord || (isBoundary(text, at - 1) && isBoundary(text, end))) {
			ranges.push([at, end]);
		}
		from = end;
	}
	return ranges;
}

export function cutLine(
	text: string,
	ranges: [number, number][],
): { text: string; ranges: [number, number][] } {
	const limit = TEXT_SEARCH_LIMITS.lineChars;
	if (text.length <= limit) return { text, ranges };
	const first = ranges[0]?.[0] ?? 0;
	const start = Math.max(0, Math.min(first - Math.floor(limit / 4), text.length - limit));
	const end = start + limit;
	const prefix = start > 0 ? "…" : "";
	const shift = prefix.length - start;
	return {
		text: `${prefix}${text.slice(start, end)}${end < text.length ? "…" : ""}`,
		ranges: ranges
			.filter(([from, to]) => from >= start && to <= end)
			.map(([from, to]) => [from + shift, to + shift]),
	};
}

interface GrepRecord {
	path: string;
	line: number;
	text: string;
}

const NEWLINE = 0x0a;
const NUL = 0x00;

function concat(parts: readonly Uint8Array[], bytes: number): Uint8Array {
	const out = new Uint8Array(bytes);
	let offset = 0;
	for (const part of parts) {
		out.set(part, offset);
		offset += part.byteLength;
	}
	return out;
}

function parseRecord(bytes: Uint8Array, decoder: TextDecoder): GrepRecord | null {
	const pathEnd = bytes.indexOf(NUL);
	if (pathEnd === -1) return null;
	const lineEnd = bytes.indexOf(NUL, pathEnd + 1);
	if (lineEnd === -1) return null;
	const line = Number(decoder.decode(bytes.subarray(pathEnd + 1, lineEnd)));
	if (!Number.isInteger(line) || line < 1) return null;
	let text = decoder.decode(bytes.subarray(lineEnd + 1));
	if (text.endsWith("\r")) text = text.slice(0, -1);
	return { path: decoder.decode(bytes.subarray(0, pathEnd)), line, text };
}

export async function* grepRecords(chunks: AsyncIterable<Uint8Array>): AsyncGenerator<GrepRecord> {
	const decoder = new TextDecoder();
	let pending: Uint8Array[] = [];
	let pendingBytes = 0;
	let overflowed = false;
	for await (const chunk of chunks) {
		let start = 0;
		while (start < chunk.byteLength) {
			const newline = chunk.indexOf(NEWLINE, start);
			const end = newline === -1 ? chunk.byteLength : newline;
			if (!overflowed) {
				const room = TEXT_SEARCH_BUDGET.recordBytes - pendingBytes;
				const piece = chunk.subarray(start, Math.min(end, start + room));
				if (piece.byteLength > 0) {
					pending.push(piece);
					pendingBytes += piece.byteLength;
				}
				if (end - start > room) overflowed = true;
			}
			if (newline === -1) break;
			const record = parseRecord(concat(pending, pendingBytes), decoder);
			pending = [];
			pendingBytes = 0;
			overflowed = false;
			if (record) yield record;
			start = newline + 1;
		}
	}
}

async function* readerChunks(
	reader: ReadableStreamDefaultReader<Uint8Array>,
): AsyncGenerator<Uint8Array> {
	while (true) {
		const next = await reader.read();
		if (next.done) return;
		yield next.value;
	}
}

async function withinSizeLimit(path: string): Promise<boolean> {
	try {
		return (await stat(path)).size <= TEXT_SEARCH_LIMITS.fileBytes;
	} catch {
		return false;
	}
}

export async function searchText(
	root: SearchRoot,
	query: TextQuery,
	emit: (batch: Omit<TextSearchBatch, "seq">) => void,
	signal: AbortSignal,
	now: () => number = () => performance.now(),
): Promise<void> {
	const run = gitAsyncStream(root.root, textSearchArgs(root, query), {
		env: { ...nonInteractiveGitEnv(), LC_ALL: "C" },
		timeoutMs: TEXT_SEARCH_BUDGET.gitTimeoutMs,
	});
	const reader = run.stdout.getReader();
	const cancel = () => void reader.cancel().catch(() => {});
	if (signal.aborted) cancel();
	else signal.addEventListener("abort", cancel, { once: true });

	const allowed = new Map<string, boolean>();
	const files = new Set<string>();
	let lines = 0;
	let batch: TextSearchFile[] = [];
	let flushedAt = now();
	let reason: TextSearchEnd = "complete";
	let streamFailed = false;
	const flush = () => {
		if (batch.length > 0 && !signal.aborted) emit({ files: batch });
		batch = [];
		flushedAt = now();
	};

	try {
		for await (const record of grepRecords(readerChunks(reader))) {
			if (signal.aborted) break;
			let fits = allowed.get(record.path);
			if (fits === undefined) {
				fits = await withinSizeLimit(join(root.root, record.path));
				allowed.set(record.path, fits);
			}
			if (!fits) continue;
			const ranges = matchRanges(record.text, query);
			if (ranges.length === 0) continue;
			const [first] = ranges;
			const cut = cutLine(record.text, ranges);
			let target = batch[batch.length - 1];
			if (target?.path !== record.path) {
				target = { path: record.path, matches: [] };
				batch.push(target);
			}
			target.matches.push({
				line: record.line,
				column: (first?.[0] ?? 0) + 1,
				length: first ? first[1] - first[0] : 0,
				text: cut.text,
				ranges: cut.ranges,
			});
			files.add(record.path);
			lines += 1;
			if (lines >= TEXT_SEARCH_LIMITS.lines) {
				reason = "limit";
				cancel();
				break;
			}
			if (now() - flushedAt >= TEXT_SEARCH_BUDGET.flushMs) flush();
		}
	} catch {
		streamFailed = true;
	}
	signal.removeEventListener("abort", cancel);
	const exit = await run.exited;
	if (signal.aborted) return;
	const nothingMatched =
		streamFailed && exit.err.trim() === "" && !exit.timedOut && !exit.launchFailed;
	if (reason !== "limit" && !exit.ok && !nothingMatched) reason = "failed";
	flush();
	emit({ files: [], done: { reason, files: files.size, lines } });
}
