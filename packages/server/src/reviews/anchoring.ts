import { createHash } from "node:crypto";
import type { ReviewAnchor, ReviewAnchorState, ReviewSelector } from "@thinkrail/contracts";

export function hashContent(content: string): string {
	return createHash("sha256").update(content).digest("hex");
}

export const TEXT_QUOTE_CONTEXT_CHARS = 32;

type LineRange = Extract<ReviewSelector, { kind: "lineRange" }>;
type TextQuote = Extract<ReviewSelector, { kind: "textQuote" }>;

export function lineRangeOf(anchor: ReviewAnchor): LineRange | undefined {
	return anchor.selectors.find((s): s is LineRange => s.kind === "lineRange");
}

export function textQuoteOf(anchor: ReviewAnchor): TextQuote | undefined {
	return anchor.selectors.find((s): s is TextQuote => s.kind === "textQuote");
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

export function reanchor(anchor: ReviewAnchor, content: string | null): ReanchorResult {
	if (content === null) return { state: "outdated", anchor };
	const hash = hashContent(content);
	if (anchor.contentHash === hash) return { state: "anchored", anchor };

	const quote = textQuoteOf(anchor);
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
