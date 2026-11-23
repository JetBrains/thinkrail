import { Buffer } from "node:buffer";
import type { FileHandle } from "node:fs/promises";
import {
	SEARCH_RULES,
	type SearchField,
	type SearchHit,
	type SearchSnippet,
	type SearchTerm,
	TRACE_LABEL_CHARS,
} from "./core.ts";
import { failureFacts } from "./facts.ts";
import { REDACTED, type Redactor, safeCut, safeStart, secretUnder } from "./redact.ts";
import {
	eventIdAt,
	KIND_LLM,
	KIND_TOOL,
	KIND_TURN,
	type SearchColumns,
	searchStrings,
} from "./searchIndex.ts";
import { isRecord } from "./totals.ts";
import { callLabel } from "./trace.ts";

const LEAF_LIMIT = 2000;
const DEPTH_LIMIT = 10;
/** Lines closer than this are read in one piece. */
const RUN_GAP = 64 * 1024;
/** A read's size, unless one line is longer. */
const RUN_BYTES = 2 * 1024 * 1024;

const utf8 = new TextDecoder("utf-8", { ignoreBOM: true });

/**
 * A free-text term as the scan matches it: case-insensitively, by ASCII case for an ASCII term (no other
 * character folds to ASCII) and by Unicode simple case folding otherwise.
 */
export interface CompiledTerm {
	text: string;
	ascii: boolean;
	/** The term in a parsed string. */
	pattern: RegExp;
	/**
	 * The term as a JSON string holds it (`"` → `\\"`, `\\` → `\\\\`, controls escaped): over a run's bytes
	 * read as Latin-1 for an ASCII term, over one decoded line otherwise.
	 */
	raw: RegExp;
}

function isAscii(text: string): boolean {
	for (let at = 0; at < text.length; at++) if (text.charCodeAt(at) > 0x7f) return false;
	return true;
}

function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function compileTerms(terms: readonly SearchTerm[]): CompiledTerm[] {
	return terms.map((term) => {
		const ascii = isAscii(term.text);
		const flags = ascii ? "gi" : "giu";
		return {
			text: term.text,
			ascii,
			pattern: new RegExp(escapeRegExp(term.text), flags),
			raw: new RegExp(escapeRegExp(JSON.stringify(term.text).slice(1, -1)), flags),
		};
	});
}

function has(pattern: RegExp, text: string): boolean {
	pattern.lastIndex = 0;
	const found = pattern.test(text);
	pattern.lastIndex = 0;
	return found;
}

function occurrences(text: string, pattern: RegExp): number {
	pattern.lastIndex = 0;
	let count = 0;
	for (const _ of text.matchAll(pattern)) count += 1;
	return count;
}

/** A field's strings, each matched on its own: a term never spans two strings (nor does its JSON form). */
interface FieldTexts {
	field: SearchField;
	texts: string[];
}

function blockTexts(content: unknown): string[] {
	if (typeof content === "string") return [content];
	if (!Array.isArray(content)) return [];
	const out: string[] = [];
	for (const block of content)
		if (isRecord(block) && block.type === "text" && typeof block.text === "string")
			out.push(block.text);
	return out;
}

/**
 * An argument's string leaves, those at or under a secret-named key (`secretUnder`) left out (they leave
 * masked, as in `event.get`).
 */
function leaves(value: unknown, out: string[], depth: number, secret = false): void {
	if (out.length >= LEAF_LIMIT || depth > DEPTH_LIMIT) return;
	if (typeof value === "string") {
		if (!secret) out.push(value);
	} else if (Array.isArray(value)) for (const item of value) leaves(item, out, depth + 1, secret);
	else if (isRecord(value))
		for (const [key, item] of Object.entries(value))
			leaves(item, out, depth + 1, secretUnder(key, secret));
}

function toolCalls(message: Record<string, unknown>): Record<string, unknown>[] {
	const content = Array.isArray(message.content) ? message.content : [];
	return content.filter(
		(block): block is Record<string, unknown> => isRecord(block) && block.type === "toolCall",
	);
}

/** The line's searchable strings for the event: a prompt, a reply and its error, a call's arguments, a result. */
function lineFields(
	kind: number,
	result: boolean,
	call: number,
	entry: Record<string, unknown>,
): FieldTexts[] {
	if (entry.type === "custom_message")
		return kind === KIND_TURN ? [{ field: "prompt", texts: blockTexts(entry.content) }] : [];
	const message = isRecord(entry.message) ? entry.message : null;
	if (!message) return [];
	if (kind === KIND_TURN) return [{ field: "prompt", texts: blockTexts(message.content) }];
	if (kind === KIND_LLM) {
		const out: FieldTexts[] = [{ field: "reply", texts: blockTexts(message.content) }];
		if (typeof message.errorMessage === "string")
			out.push({ field: "error", texts: [message.errorMessage] });
		return out;
	}
	if (result) {
		if (message.role !== "toolResult") return [];
		return [
			{ field: message.isError === true ? "error" : "result", texts: blockTexts(message.content) },
		];
	}
	const texts: string[] = [];
	leaves(toolCalls(message)[call]?.arguments, texts, 0);
	return [{ field: "args", texts }];
}

/** The bit of each term found in the fields. */
function termBits(fields: readonly FieldTexts[], terms: readonly CompiledTerm[]): number {
	let bits = 0;
	terms.forEach((term, index) => {
		for (const { texts } of fields)
			for (const text of texts)
				if (has(term.pattern, text)) {
					bits |= 1 << index;
					return;
				}
	});
	return bits;
}

/** Whether the parsed line is the entry the columns recorded at its offset. */
function sameEntry(
	entry: unknown,
	offset: number,
	expected: string | null,
	result: boolean,
): entry is Record<string, unknown> {
	if (!isRecord(entry)) return false;
	if (result && !(isRecord(entry.message) && entry.message.role === "toolResult")) return false;
	if (expected === null) return true;
	return (typeof entry.id === "string" ? entry.id : `@${offset}`) === expected;
}

/** An event's use of a line: its own line, or a tool's result line. */
export interface LineUse {
	pos: number;
	result: boolean;
}

export interface LinePlan {
	at: number;
	length: number;
	uses: LineUse[];
}

/** The lines the candidate events need, in file order, each once. */
export function linePlan(columns: SearchColumns, positions: Int32Array): LinePlan[] {
	const refs: { at: number; length: number; use: LineUse }[] = [];
	for (const pos of positions) {
		const at = columns.lineAt[pos] ?? -1;
		if (at >= 0)
			refs.push({ at, length: columns.lineLength[pos] ?? 0, use: { pos, result: false } });
		const resultAt = columns.resultAt[pos] ?? -1;
		if (columns.kind[pos] === KIND_TOOL && resultAt >= 0)
			refs.push({
				at: resultAt,
				length: columns.resultLength[pos] ?? 0,
				use: { pos, result: true },
			});
	}
	refs.sort((a, b) => a.at - b.at || a.use.pos - b.use.pos);
	const lines: LinePlan[] = [];
	for (const ref of refs) {
		const last = lines.at(-1);
		if (last && last.at === ref.at) last.uses.push(ref.use);
		else lines.push({ at: ref.at, length: ref.length, uses: [ref.use] });
	}
	return lines;
}

/** The entry id a use of a line must carry; `null` where the role check is the verification. */
function expectedEntry(columns: SearchColumns, use: LineUse): string | null {
	if (use.result && (columns.call[use.pos] ?? -1) >= 0) return null;
	return columns.entryIds[columns.entry[use.pos] ?? 0] ?? null;
}

async function readInto(handle: FileHandle, at: number, length: number): Promise<Uint8Array> {
	const bytes = new Uint8Array(length);
	let read = 0;
	while (read < length) {
		const { bytesRead } = await handle.read(bytes, read, length - read, at + read);
		if (bytesRead === 0) break;
		read += bytesRead;
	}
	return bytes.subarray(0, read);
}

/** The run of lines from `from` read in one piece: neighbours closer than `RUN_GAP`, up to `RUN_BYTES`. */
function runEnd(lines: readonly LinePlan[], from: number): number {
	const first = lines[from];
	if (!first) return from;
	let end = from + 1;
	let last = first;
	while (end < lines.length) {
		const next = lines[end];
		if (!next) break;
		const gap = next.at - (last.at + last.length);
		if (gap > RUN_GAP || next.at + next.length - first.at > RUN_BYTES) break;
		last = next;
		end += 1;
	}
	return end;
}

/**
 * Which lines of a run hold a term: ASCII terms are found in the run's bytes read as Latin-1 (ASCII
 * bytes map to themselves and no other byte folds to ASCII, so the JSON-escaped term is found wherever a
 * string holds it); other terms in each line decoded. A superset of the lines whose strings match.
 */
function prefilterRun(
	bytes: Uint8Array,
	base: number,
	lines: readonly LinePlan[],
	terms: readonly CompiledTerm[],
): Uint8Array {
	const hit = new Uint8Array(lines.length);
	const ascii = terms.filter((term) => term.ascii);
	if (ascii.length > 0) {
		const text = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.length).toString("latin1");
		for (const { raw } of ascii) {
			raw.lastIndex = 0;
			let found = raw.exec(text);
			while (found) {
				const offset = base + found.index;
				let next = found.index + 1;
				let low = 0;
				let high = lines.length - 1;
				while (low <= high) {
					const mid = (low + high) >> 1;
					const line = lines[mid];
					if (!line) break;
					if (offset < line.at) high = mid - 1;
					else if (offset >= line.at + line.length) low = mid + 1;
					else {
						hit[mid] = 1;
						next = line.at + line.length - base;
						break;
					}
				}
				raw.lastIndex = next;
				found = raw.exec(text);
			}
		}
	}
	const other = terms.filter((term) => !term.ascii);
	if (other.length > 0)
		lines.forEach((line, index) => {
			if (hit[index]) return;
			const start = line.at - base;
			const text = utf8.decode(bytes.subarray(start, start + line.length));
			if (other.some((term) => has(term.raw, text))) hit[index] = 1;
		});
	return hit;
}

export interface ScanCursor {
	lines: LinePlan[];
	next: number;
	bits: Uint8Array;
}

export interface ScanControl {
	/** Pauses for the event loop when due; `false` once the scan must stop (cancelled or out of time). */
	keepGoing(): Promise<boolean>;
	/** Off only in tests: every line is parsed. */
	prefilter: boolean;
}

/**
 * Matches the terms against the planned lines from `cursor.next` on, OR-ing each event's term bits.
 * Returns `false` when it stopped early (the cursor says where to resume), `true` at the end.
 */
export async function scanLines(
	handle: FileHandle,
	columns: SearchColumns,
	terms: readonly CompiledTerm[],
	cursor: ScanCursor,
	control: ScanControl,
): Promise<boolean> {
	const { lines } = cursor;
	while (cursor.next < lines.length) {
		const from = cursor.next;
		const end = runEnd(lines, from);
		const first = lines[from];
		const last = lines[end - 1];
		if (!first || !last) break;
		const run = lines.slice(from, end);
		const bytes = await readInto(handle, first.at, last.at + last.length - first.at);
		const hits = control.prefilter
			? prefilterRun(bytes, first.at, run, terms)
			: new Uint8Array(run.length).fill(1);
		for (let index = 0; index < run.length; index++) {
			const line = run[index];
			if (line && hits[index]) {
				const start = line.at - first.at;
				const slice = bytes.subarray(start, start + line.length);
				let entry: unknown;
				try {
					entry = slice.length === line.length ? JSON.parse(utf8.decode(slice)) : undefined;
				} catch {
					entry = undefined;
				}
				for (const use of line.uses) {
					if (!sameEntry(entry, line.at, expectedEntry(columns, use), use.result)) continue;
					const fields = lineFields(
						columns.kind[use.pos] ?? 0,
						use.result,
						columns.call[use.pos] ?? -1,
						entry,
					);
					cursor.bits[use.pos] = (cursor.bits[use.pos] ?? 0) | termBits(fields, terms);
				}
			}
			cursor.next = from + index + 1;
			if (!(await control.keepGoing())) return cursor.next >= lines.length;
		}
	}
	return true;
}

function flat(text: string): string {
	return text.replace(/\s+/g, " ");
}

function marksIn(text: string, terms: readonly CompiledTerm[]): [number, number][] {
	const found: [number, number][] = [];
	for (const term of terms) {
		term.pattern.lastIndex = 0;
		for (const match of text.matchAll(term.pattern))
			found.push([match.index, match.index + match[0].length]);
	}
	found.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
	const merged: [number, number][] = [];
	for (const mark of found) {
		const last = merged.at(-1);
		if (last && mark[0] <= last[1]) last[1] = Math.max(last[1], mark[1]);
		else merged.push([mark[0], mark[1]]);
	}
	return merged;
}

/** Whether `[from, to)` of masked text overlaps a `[redacted]`. */
function inMask(text: string, from: number, to: number): boolean {
	const at = text.lastIndexOf(REDACTED, to - 1);
	return at >= 0 && at + REDACTED.length > from;
}

/**
 * A one-line snippet of `text` around `at` (a raw offset), cut from the text masked around it
 * (`Redactor.around`), so a secret crossing the window is masked with the text that names it. It centres
 * on the first match masking kept, else on where `at` lands; marks are the terms found in what is shown.
 */
function snippetOf(
	redactor: Redactor,
	field: SearchField,
	text: string,
	at: number,
	terms: readonly CompiledTerm[],
): SearchSnippet {
	const { snippetChars, snippetLead } = SEARCH_RULES;
	const span = redactor.around(text, at, at);
	const cleaned = flat(span.text);
	const allMarks = marksIn(cleaned, terms);
	const anchor =
		(allMarks.find(([from, to]) => !inMask(cleaned, from, to)) ?? allMarks[0])?.[0] ??
		Math.round(span.at * (cleaned.length / Math.max(1, span.text.length)));
	let start = Math.max(0, anchor - snippetLead);
	const end = safeCut(cleaned, Math.min(cleaned.length, start + snippetChars));
	start = safeStart(cleaned, Math.max(0, Math.min(start, end - snippetChars)));
	let shown = cleaned.slice(start, Math.max(start, end));
	const lead = shown.length - shown.trimStart().length;
	shown = shown.trim();
	const offset = start + lead;
	return {
		field,
		text: shown,
		marks: allMarks
			.filter(([from, to]) => from >= offset && to <= offset + shown.length)
			.map(([from, to]) => [from - offset, to - offset] as const),
		head: !span.start || start > 0,
		tail: !span.end || end < cleaned.length,
	};
}

/** Where the first term first occurs in `text`, or -1. */
function firstMatch(text: string, terms: readonly CompiledTerm[]): number {
	let best = -1;
	for (const term of terms) {
		const at = text.search(term.pattern);
		if (at >= 0 && (best < 0 || at < best)) best = at;
	}
	return best;
}

const FIELD_ORDER: readonly SearchField[] = ["args", "error", "prompt", "reply", "result"];

/** The fields of an event's lines, own line first. */
interface EventLines {
	own: Record<string, unknown> | null;
	result: Record<string, unknown> | null;
}

/** A hit for the event at `pos`, from its parsed lines: label, snippet, per-field counts, error line. */
function hitOf(
	columns: SearchColumns,
	pos: number,
	lines: EventLines,
	terms: readonly CompiledTerm[],
	redactor: Redactor,
): SearchHit {
	const kind = columns.kind[pos] ?? 0;
	const call = columns.call[pos] ?? -1;
	const fields: FieldTexts[] = [
		...(lines.own ? lineFields(kind, false, call, lines.own) : []),
		...(lines.result ? lineFields(kind, true, call, lines.result) : []),
	];
	const counts = new Map<SearchField, number>();
	let snippet: SearchSnippet | null = null;
	const ordered = [...fields].sort(
		(a, b) => FIELD_ORDER.indexOf(a.field) - FIELD_ORDER.indexOf(b.field),
	);
	for (const { field, texts } of ordered)
		for (const text of texts) {
			let count = 0;
			for (const term of terms) count += occurrences(text, term.pattern);
			if (count === 0) continue;
			counts.set(field, (counts.get(field) ?? 0) + count);
			if (!snippet) snippet = snippetOf(redactor, field, text, firstMatch(text, terms), terms);
		}
	const error = columns.error[pos] === 1;
	let label = "";
	let errorLine: string | null = null;
	const message = lines.own && isRecord(lines.own.message) ? lines.own.message : null;
	if (kind === KIND_TOOL) {
		const issued = message ? toolCalls(message)[call] : undefined;
		const name = searchStrings.value(columns.tool[pos] ?? -1);
		const args = isRecord(issued?.arguments) ? issued.arguments : {};
		label = callLabel(redactor, name, args);
		const resultMessage =
			lines.result && isRecord(lines.result.message) ? lines.result.message : null;
		if (error && resultMessage)
			errorLine = failureFacts(
				name,
				blockTexts(resultMessage.content).join("\n"),
				redactor,
			).errorLine;
	} else {
		const own =
			fields
				.find((field) => field.field === "prompt" || field.field === "reply")
				?.texts.join("\n") ?? "";
		const errorText = fields.find((field) => field.field === "error")?.texts[0] ?? "";
		label =
			redactor.label(own, TRACE_LABEL_CHARS, kind === KIND_LLM) ||
			redactor.label(errorText, TRACE_LABEL_CHARS, true);
		if (error && kind === KIND_LLM)
			errorLine = failureFacts("model", errorText, redactor).errorLine;
	}
	return {
		eventId: eventIdAt(columns, pos),
		kind: kind === KIND_TURN ? "turn" : kind === KIND_LLM ? "llm" : "tool",
		turn: columns.turn[pos] ?? 0,
		t: columns.t[pos] ?? 0,
		tool: kind === KIND_TOOL ? searchStrings.value(columns.tool[pos] ?? -1) || null : null,
		model: searchStrings.value(columns.model[pos] ?? -1) || null,
		skill: searchStrings.value(columns.skill[pos] ?? -1) || null,
		error,
		label,
		snippet,
		fields: FIELD_ORDER.flatMap((field) => {
			const count = counts.get(field);
			return count ? [{ field, count }] : [];
		}),
		errorLine,
	};
}

/** Re-reads the events' lines (one handle, file order) and builds their hits, in the given order. */
export async function readHits(
	handle: FileHandle,
	columns: SearchColumns,
	positions: readonly number[],
	terms: readonly CompiledTerm[],
	redactor: Redactor,
): Promise<SearchHit[]> {
	const plan = linePlan(columns, Int32Array.from(positions));
	const parsed = new Map<number, EventLines>();
	for (const pos of positions) parsed.set(pos, { own: null, result: null });
	for (const line of plan) {
		const bytes = await readInto(handle, line.at, line.length);
		let entry: unknown;
		try {
			entry = bytes.length === line.length ? JSON.parse(utf8.decode(bytes)) : undefined;
		} catch {
			entry = undefined;
		}
		for (const use of line.uses) {
			if (!sameEntry(entry, line.at, expectedEntry(columns, use), use.result)) continue;
			const slot = parsed.get(use.pos);
			if (!slot) continue;
			if (use.result) slot.result = entry;
			else slot.own = entry;
		}
	}
	return positions.map((pos) =>
		hitOf(columns, pos, parsed.get(pos) ?? { own: null, result: null }, terms, redactor),
	);
}
