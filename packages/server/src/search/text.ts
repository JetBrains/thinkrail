import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import {
	TEXT_SEARCH_LIMITS,
	type TextSearchBatch,
	type TextSearchEnd,
	type TextSearchFile,
} from "@thinkrail/contracts";
import { CodedError } from "@thinkrail/shared/codedError";
import { gitAsyncStream, nonInteractiveGitEnv } from "../git";
import { logger } from "../log";
import { type FileList, isHiddenFromSearch, listRootFiles, SEARCH_HIDDEN_DIRS } from "./files";
import type { SearchRoot } from "./providers";

const log = logger("search");

export interface TextQuery {
	query: string;
	caseSensitive: boolean;
	wholeWord: boolean;
}

export const TEXT_SEARCH_BUDGET = {
	gitTimeoutMs: 30_000,
	flushMs: 60,
	recordBytes: TEXT_SEARCH_LIMITS.fileBytes + 8 * 1024,
	rangesPerLine: 50,
	binaryProbeBytes: 8_000,
} as const;

const HIDDEN_PATHSPECS = SEARCH_HIDDEN_DIRS.map((name) => `:(exclude,glob)**/${name}/**`);
const ERE_SPECIAL = /[.[\]()*+?{}|^$\\]/g;
const REGEXP_SPECIAL = /[.*+?^${}()|[\]\\]/g;
const isCased = (char: string): boolean => char.toLowerCase() !== char.toUpperCase();

function isAscii(text: string): boolean {
	for (let index = 0; index < text.length; index += 1) {
		if (text.charCodeAt(index) > 0x7f) return false;
	}
	return true;
}

export function caseVariantsPattern(query: TextQuery): string | null {
	if (query.caseSensitive || isAscii(query.query)) return null;
	const chars = Array.from(query.query);
	if (!chars.some((char) => !isAscii(char) && isCased(char))) return null;
	return chars
		.map((char) => {
			const escaped = char.replace(ERE_SPECIAL, "\\$&");
			if (!isCased(char)) return escaped;
			const same = new RegExp(`^${char.replace(REGEXP_SPECIAL, "\\$&")}$`, "iu");
			const lower = char.toLowerCase();
			const upper = char.toUpperCase();
			const variants = [
				...new Set([char, lower, upper, upper.toLowerCase(), lower.toUpperCase()]),
			].filter((variant) => same.test(variant));
			return variants.length === 1 ? escaped : `(${variants.join("|")})`;
		})
		.join("");
}

export function textSearchArgs(query: TextQuery): string[] {
	const pattern = caseVariantsPattern(query);
	return [
		"-c",
		"grep.column=false",
		"-c",
		"grep.fullName=false",
		"grep",
		"--no-color",
		"-n",
		"-z",
		"-I",
		...(pattern !== null
			? ["--extended-regexp"]
			: ["--fixed-strings", ...(query.caseSensitive ? [] : ["-i"])]),
		...(query.wholeWord ? ["-w"] : []),
		"--untracked",
		"--exclude-standard",
		"-e",
		pattern ?? query.query,
		"--",
		".",
		...HIDDEN_PATHSPECS,
	];
}

const WORD = /[A-Za-z0-9_]/;

function isBoundary(text: string, index: number): boolean {
	return index < 0 || index >= text.length || !WORD.test(text.charAt(index));
}

export function matchRanges(text: string, query: TextQuery): [number, number][] {
	if (!query.query) return [];
	const pattern = new RegExp(
		query.query.replace(REGEXP_SPECIAL, "\\$&"),
		query.caseSensitive ? "gu" : "giu",
	);
	const ranges: [number, number][] = [];
	while (ranges.length < TEXT_SEARCH_BUDGET.rangesPerLine) {
		const match = pattern.exec(text);
		if (!match) break;
		const at = match.index;
		const end = at + match[0].length;
		if (!query.wholeWord || (isBoundary(text, at - 1) && isBoundary(text, end))) {
			ranges.push([at, end]);
		} else {
			pattern.lastIndex = at + 1;
		}
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

/** A path may hold a newline: only the text field of `path NUL line NUL text` ends at LF. */
export async function* grepRecords(chunks: AsyncIterable<Uint8Array>): AsyncGenerator<GrepRecord> {
	const decoder = new TextDecoder();
	let field = 0;
	let parts: Uint8Array[] = [];
	let partBytes = 0;
	let recordBytes = 0;
	let overflowed = false;
	let path = "";
	let line = 0;
	const take = (): string => {
		const value = decoder.decode(concat(parts, partBytes));
		parts = [];
		partBytes = 0;
		return value;
	};
	for await (const chunk of chunks) {
		let start = 0;
		while (start < chunk.byteLength) {
			const found = chunk.indexOf(field === 2 ? NEWLINE : NUL, start);
			const end = found === -1 ? chunk.byteLength : found;
			if (!overflowed) {
				const room = TEXT_SEARCH_BUDGET.recordBytes - recordBytes;
				const piece = chunk.subarray(start, Math.min(end, start + room));
				if (piece.byteLength > 0) {
					parts.push(piece);
					partBytes += piece.byteLength;
					recordBytes += piece.byteLength;
				}
				if (end - start > room) overflowed = true;
			}
			if (found === -1) break;
			start = found + 1;
			if (field === 0) {
				path = take();
				field = 1;
				continue;
			}
			if (field === 1) {
				line = Number(take());
				field = 2;
				continue;
			}
			let text = take();
			if (text.endsWith("\r")) text = text.slice(0, -1);
			const complete = !overflowed && Number.isInteger(line) && line >= 1;
			field = 0;
			recordBytes = 0;
			overflowed = false;
			if (complete) yield { path, line, text };
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

async function searchableText(path: string): Promise<string | null> {
	try {
		const info = await stat(path);
		if (!info.isFile() || info.size > TEXT_SEARCH_LIMITS.fileBytes) return null;
		const bytes = await readFile(path);
		if (bytes.subarray(0, TEXT_SEARCH_BUDGET.binaryProbeBytes).includes(NUL)) return null;
		return new TextDecoder().decode(bytes);
	} catch {
		return null;
	}
}

async function* walkedRecords(
	root: string,
	paths: readonly string[],
	query: TextQuery,
	signal: AbortSignal,
): AsyncGenerator<GrepRecord> {
	for (const path of paths) {
		if (signal.aborted) return;
		const content = await searchableText(join(root, path));
		if (content === null) continue;
		let line = 0;
		for (const raw of content.split("\n")) {
			line += 1;
			const text = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
			if (matchRanges(text, query).length > 0) yield { path, line, text };
		}
	}
}

export interface TextSearchOptions {
	files?: (root: string) => Promise<FileList>;
}

export async function searchText(
	root: SearchRoot,
	query: TextQuery,
	emit: (batch: Omit<TextSearchBatch, "seq">) => void,
	signal: AbortSignal,
	options: TextSearchOptions = {},
): Promise<void> {
	const files = new Set<string>();
	let lines = 0;
	let batch: TextSearchFile[] = [];
	let timer: ReturnType<typeof setTimeout> | null = null;
	let reason: TextSearchEnd = "complete";
	const flush = () => {
		if (timer) clearTimeout(timer);
		timer = null;
		if (batch.length > 0 && !signal.aborted) emit({ files: batch });
		batch = [];
	};
	const take = (record: GrepRecord): boolean => {
		if (isHiddenFromSearch(record.path)) return false;
		const ranges = matchRanges(record.text, query);
		if (ranges.length === 0) return false;
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
		if (lines === 1) flush();
		else timer ??= setTimeout(flush, TEXT_SEARCH_BUDGET.flushMs);
		return lines >= TEXT_SEARCH_LIMITS.lines;
	};
	const finish = (failure: CodedError | null) => {
		if (signal.aborted) {
			if (timer) clearTimeout(timer);
			return;
		}
		if (failure && reason !== "limit") {
			reason = "failed";
			log.warn("text search failed", failure);
		}
		flush();
		emit({ files: [], done: { reason, files: files.size, lines } });
	};

	if (!root.git) {
		let failure: CodedError | null = null;
		try {
			const list = await (options.files ?? ((dir) => listRootFiles(dir, false)))(root.root);
			for await (const record of walkedRecords(root.root, list.paths, query, signal)) {
				if (signal.aborted) break;
				if (take(record)) {
					reason = "limit";
					break;
				}
			}
		} catch {
			failure = new CodedError("TEXT_SEARCH_FAILED", "the folder could not be listed");
		}
		finish(failure);
		return;
	}

	const run = gitAsyncStream(root.root, textSearchArgs(query), {
		env: { ...nonInteractiveGitEnv(), LC_ALL: "C" },
		timeoutMs: TEXT_SEARCH_BUDGET.gitTimeoutMs,
	});
	const reader = run.stdout.getReader();
	const cancel = () => void reader.cancel().catch(() => {});
	if (signal.aborted) cancel();
	else signal.addEventListener("abort", cancel, { once: true });
	const allowed = new Map<string, boolean>();
	let streamFailed = false;
	try {
		for await (const record of grepRecords(readerChunks(reader))) {
			if (signal.aborted) break;
			let fits = allowed.get(record.path);
			if (fits === undefined) {
				fits = await withinSizeLimit(join(root.root, record.path));
				allowed.set(record.path, fits);
			}
			if (fits && take(record)) {
				reason = "limit";
				cancel();
				break;
			}
		}
	} catch {
		streamFailed = true;
	}
	signal.removeEventListener("abort", cancel);
	const exit = await run.exited;
	const nothingMatched =
		streamFailed && exit.err.trim() === "" && !exit.timedOut && !exit.launchFailed;
	finish(
		exit.ok || nothingMatched
			? null
			: exit.timedOut
				? new CodedError("TEXT_SEARCH_TIMEOUT", "git grep ran past the text search budget")
				: new CodedError(
						"TEXT_SEARCH_FAILED",
						exit.launchFailed ? "git grep could not start" : "git grep exited abnormally",
					),
	);
}
