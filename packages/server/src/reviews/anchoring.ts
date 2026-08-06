// Pure anchoring: capture-time helpers + the re-anchor pipeline (see SPEC.md). No fs, no store — the
// caller hands in the file content (or null when the file is gone) and folds the verdict back.

import { createHash } from "node:crypto";
import type { ReviewAnchor, ReviewAnchorState, ReviewSelector } from "@thinkrail/contracts";

/** The cheap "nothing changed" identity: sha-256 of the file content at comment time. */
export function hashContent(content: string): string {
	return createHash("sha256").update(content).digest("hex");
}

/** How much surrounding text a `textQuote` selector carries on each side of the exact fragment. */
export const TEXT_QUOTE_CONTEXT_CHARS = 32;

type LineRange = Extract<ReviewSelector, { kind: "lineRange" }>;
type TextQuote = Extract<ReviewSelector, { kind: "textQuote" }>;

export function lineRangeOf(anchor: ReviewAnchor): LineRange | undefined {
	return anchor.selectors.find((s): s is LineRange => s.kind === "lineRange");
}

export function textQuoteOf(anchor: ReviewAnchor): TextQuote | undefined {
	return anchor.selectors.find((s): s is TextQuote => s.kind === "textQuote");
}

/**
 * Build a `textQuote` selector for the given 1-based inclusive line range of `content` — the exact
 * selected lines plus bounded prefix/suffix context for disambiguation. Used at capture time (the host
 * fills it when the client didn't) and by tests.
 */
export function buildTextQuote(content: string, startLine: number, endLine: number): TextQuote {
	const lines = content.split("\n");
	const start = Math.max(1, startLine);
	const end = Math.min(lines.length, Math.max(start, endLine));
	const before = lines.slice(0, start - 1).join("\n");
	const exact = lines.slice(start - 1, end).join("\n");
	const after = lines.slice(end).join("\n");
	// The separators the slices dropped are part of the true context (an exact fragment that starts a
	// file must not accidentally match mid-line).
	const prefixRaw = before.length > 0 ? `${before}\n` : "";
	const suffixRaw = after.length > 0 ? `\n${after}` : "";
	return {
		kind: "textQuote",
		exact,
		prefix: prefixRaw.slice(-TEXT_QUOTE_CONTEXT_CHARS),
		suffix: suffixRaw.slice(0, TEXT_QUOTE_CONTEXT_CHARS),
	};
}

/** All indices at which `needle` occurs in `haystack` (non-overlapping scan is enough here). */
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

/** The 1-based line number a character offset falls on. */
function lineAt(content: string, offset: number): number {
	let line = 1;
	for (let i = 0; i < offset; i++) if (content.charCodeAt(i) === 10) line++;
	return line;
}

export interface ReanchorResult {
	state: ReviewAnchorState;
	/** The updated anchor (line range re-pinned + fresh contentHash) when the state is not `outdated`. */
	anchor: ReviewAnchor;
}

/**
 * Re-anchor one comment against the current file content (`null` = the file is gone). The pipeline the
 * SPEC records: contentHash match → `anchored`; else a unique `textQuote.exact` match (prefix/suffix
 * break ties) → `moved` with the line range re-pinned; else → `outdated` (anchor kept as-is, so the
 * creation-time snapshot survives).
 */
export function reanchor(anchor: ReviewAnchor, content: string | null): ReanchorResult {
	if (content === null) return { state: "outdated", anchor };
	const hash = hashContent(content);
	if (anchor.contentHash === hash) return { state: "anchored", anchor };

	const quote = textQuoteOf(anchor);
	// A file-level anchor has no fragment to find — content changed, but the file is still there.
	if (!quote) return { state: "moved", anchor: { ...anchor, contentHash: hash } };

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
