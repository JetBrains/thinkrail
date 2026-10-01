import { createHash } from "node:crypto";
import type { ReviewAnchor, ReviewAnchorState, ReviewSelector } from "@thinkrail/contracts";

export function hashContent(content: string | Uint8Array): string {
	return createHash("sha256").update(content).digest("hex");
}

export const TEXT_QUOTE_CONTEXT_CHARS = 32;

type LineRange = Extract<ReviewSelector, { kind: "lineRange" }>;
type TextQuote = Extract<ReviewSelector, { kind: "textQuote" }>;
type DiffHunk = Extract<ReviewSelector, { kind: "diffHunk" }>;
type Structural = Extract<ReviewSelector, { kind: "structural" }>;
type Region = Extract<ReviewSelector, { kind: "region" }>;

const STRUCTURAL_SCHEME = /^[a-z][a-z0-9-]*$/;

export function lineRangeOf(anchor: ReviewAnchor): LineRange | undefined {
	return anchor.selectors.find((s): s is LineRange => s.kind === "lineRange");
}

export function textQuoteOf(anchor: ReviewAnchor): TextQuote | undefined {
	return anchor.selectors.find((s): s is TextQuote => s.kind === "textQuote");
}

export function isPositioned(anchor: ReviewAnchor): boolean {
	return anchor.selectors.some(
		(s) => s.kind === "lineRange" || s.kind === "structural" || s.kind === "region",
	);
}

function shown(value: unknown): string {
	if (typeof value === "string") return JSON.stringify(value);
	if (value === null) return "null";
	if (Array.isArray(value)) return "an array";
	if (typeof value === "object") return "an object";
	return String(value);
}

function selectorFields(value: unknown): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value))
		throw new Error(`A selector must be an object, got ${shown(value)}.`);
	return value as Record<string, unknown>;
}

function fraction(fields: Record<string, unknown>, name: string): number {
	const value = fields[name];
	if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1)
		throw new Error(
			`A region selector's ${name} must be a fraction in [0, 1], got ${shown(value)}.`,
		);
	return value;
}

function page(value: unknown): number | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== "number" || !Number.isInteger(value) || value < 1)
		throw new Error(`A region selector's page must be a positive integer, got ${shown(value)}.`);
	return value;
}

function narrowRegion(fields: Record<string, unknown>): Region {
	const paged = page(fields.page);
	return {
		kind: "region",
		x: fraction(fields, "x"),
		y: fraction(fields, "y"),
		width: fraction(fields, "width"),
		height: fraction(fields, "height"),
		...(paged === undefined ? {} : { page: paged }),
	};
}

function integer(value: unknown): number | null {
	return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function narrowLineRange(fields: Record<string, unknown>): LineRange {
	const startLine = integer(fields.startLine);
	const endLine = integer(fields.endLine);
	if (startLine === null || endLine === null)
		throw new Error(
			`A lineRange selector's lines must be integers, got ${shown(fields.startLine)}-${shown(fields.endLine)}.`,
		);
	if (startLine < 1 || endLine < startLine)
		throw new Error(
			`A lineRange selector must run from line 1 onwards, got ${startLine}-${endLine}.`,
		);
	return { kind: "lineRange", startLine, endLine };
}

function narrowTextQuote(fields: Record<string, unknown>): TextQuote {
	const { exact, prefix, suffix } = fields;
	if (typeof exact !== "string" || typeof prefix !== "string" || typeof suffix !== "string")
		throw new Error("A textQuote selector needs string exact, prefix and suffix fields.");
	return { kind: "textQuote", exact, prefix, suffix };
}

function narrowDiffHunk(fields: Record<string, unknown>): DiffHunk {
	const hunkHeader = fields.hunkHeader;
	if (typeof hunkHeader !== "string")
		throw new Error(`A diffHunk selector needs a string hunkHeader, got ${shown(hunkHeader)}.`);
	return { kind: "diffHunk", hunkHeader };
}

function narrowStructural(fields: Record<string, unknown>): Structural {
	const scheme = fields.scheme;
	if (typeof scheme !== "string" || !STRUCTURAL_SCHEME.test(scheme))
		throw new Error(
			`A structural selector's scheme must match ${STRUCTURAL_SCHEME.source}, got ${shown(scheme)}.`,
		);
	const ref = fields.ref;
	if (typeof ref !== "string" || ref.length === 0)
		throw new Error(`A ${scheme} selector needs a non-empty ref, got ${shown(ref)}.`);
	return { kind: "structural", scheme, ref };
}

function narrowSelector(value: unknown): ReviewSelector {
	const fields = selectorFields(value);
	const kind = fields.kind;
	if (kind === "lineRange") return narrowLineRange(fields);
	if (kind === "textQuote") return narrowTextQuote(fields);
	if (kind === "diffHunk") return narrowDiffHunk(fields);
	if (kind === "structural") return narrowStructural(fields);
	if (kind === "region") return narrowRegion(fields);
	throw new Error(
		`Unknown selector kind ${shown(kind)} — a selector is one of lineRange, textQuote, diffHunk, structural, region.`,
	);
}

export function validateSelectors(selectors: unknown): ReviewSelector[] {
	if (!Array.isArray(selectors))
		throw new Error(`An anchor's selectors must be an array, got ${shown(selectors)}.`);
	return selectors.map(narrowSelector);
}

export function buildTextQuote(content: string, startLine: number, endLine: number): TextQuote {
	const lines = content.split("\n");
	const start = Math.max(1, startLine);
	const end = Math.min(lines.length, Math.max(start, endLine));
	const before = lines.slice(0, start - 1).join("\n");
	const exact = lines.slice(start - 1, end).join("\n");
	const after = lines.slice(end).join("\n");
	const prefixRaw = before.length > 0 ? `${before}\n` : "";
	const suffixRaw = after.length > 0 ? `\n${after}` : "";
	return {
		kind: "textQuote",
		exact,
		prefix: prefixRaw.slice(-TEXT_QUOTE_CONTEXT_CHARS),
		suffix: suffixRaw.slice(0, TEXT_QUOTE_CONTEXT_CHARS),
	};
}

function indicesOf(haystack: string, needle: string): number[] {
	if (needle.length === 0) return [];
	const out: number[] = [];
	let from = 0;
	for (;;) {
		const at = haystack.indexOf(needle, from);
		if (at < 0) return out;
		out.push(at);
		from = at + 1;
	}
}

function lineAt(content: string, offset: number): number {
	let line = 1;
	for (let i = 0; i < offset; i++) if (content.charCodeAt(i) === 10) line++;
	return line;
}

export interface ReanchorResult {
	state: ReviewAnchorState;
	anchor: ReviewAnchor;
}

function driftWithoutQuote(anchor: ReviewAnchor, hash: string): ReanchorResult {
	return isPositioned(anchor)
		? { state: "outdated", anchor }
		: { state: "moved", anchor: { ...anchor, contentHash: hash } };
}

export function reanchor(
	anchor: ReviewAnchor,
	content: string | Uint8Array | null,
): ReanchorResult {
	if (content === null) return { state: "outdated", anchor };
	const hash = hashContent(content);
	if (anchor.contentHash === hash) return { state: "anchored", anchor };
	if (typeof content !== "string") return driftWithoutQuote(anchor, hash);

	const quote = textQuoteOf(anchor);
	if (!quote) return driftWithoutQuote(anchor, hash);

	let matches = indicesOf(content, quote.exact);
	if (matches.length > 1 && (quote.prefix || quote.suffix)) {
		const disambiguated = matches.filter((at) => {
			const prefixOk = quote.prefix ? content.slice(0, at).endsWith(quote.prefix) : true;
			const suffixOk = quote.suffix
				? content.slice(at + quote.exact.length).startsWith(quote.suffix)
				: true;
			return prefixOk && suffixOk;
		});
		if (disambiguated.length > 0) matches = disambiguated;
	}
	const at = matches.length === 1 ? matches[0] : undefined;
	if (at === undefined || quote.exact.length === 0) return { state: "outdated", anchor };

	const startLine = lineAt(content, at);
	const endLine = startLine + (quote.exact.split("\n").length - 1);
	return {
		state: "moved",
		anchor: {
			...anchor,
			contentHash: hash,
			selectors: anchor.selectors.map((s) =>
				s.kind === "lineRange" ? { kind: "lineRange", startLine, endLine } : s,
			),
		},
	};
}
