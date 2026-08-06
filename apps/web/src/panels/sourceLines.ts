// Source-line stamping for the rendered markdown view (adopted from the inline-edit-v0 branch's
// anchoring): a rehype plugin marks every block element with the source line range remark parsed it
// from, so a DOM selection (the review composer's anchor), a comment's line (the in-flow card's splice
// point), and the commented-region highlight all resolve to EXACT lines instead of text-search
// heuristics.
//
// Stamps are ALWAYS raw-file lines: the preview renders `stripFrontmatter(content)` and — while a
// review is open — SEGMENTS of it (each parsed independently, so remark restarts at line 1); the
// caller passes each render's `offset` (frontmatter lines + the segment's start) and the plugin bakes
// it in, so every consumer downstream reads raw coordinates.

import type { LineSelection } from "./reviewGutter";

/** hast node shape we touch (rehype provides `position` from the remark parse). */
interface HastNode {
	type: string;
	tagName?: string;
	properties?: Record<string, unknown>;
	position?: { start: { line: number }; end: { line: number } };
	children?: HastNode[];
}

/**
 * Rehype plugin (tuple form: `[sourceLineRehype, { offset }]`): stamp every block element that carries
 * a source position with `data-md-line-start` / `data-md-line-end` (1-based RAW-file lines — the
 * render-local position plus `offset`).
 */
export function sourceLineRehype(options?: { offset?: number }): (tree: HastNode) => void {
	const offset = options?.offset ?? 0;
	const visit = (node: HastNode): void => {
		if (node.type === "element" && node.position && node.properties) {
			node.properties["data-md-line-start"] = node.position.start.line + offset;
			node.properties["data-md-line-end"] = node.position.end.line + offset;
		}
		for (const child of node.children ?? []) visit(child);
	};
	return visit;
}

/** How many leading lines `stripFrontmatter` removed — the stripped-line ↔ raw-line offset. */
export function frontmatterOffset(raw: string, stripped: string): number {
	return Math.max(0, raw.split("\n").length - stripped.split("\n").length);
}

/** A 1-based inclusive line span of the stripped document. */
export interface LineSpan {
	start: number;
	end: number;
}

/** A fence opener: up to 3 spaces of indent, then ≥3 backticks or tildes, then the info string. */
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})(.*)$/;
/** A GFM delimiter row: only pipes, colons, dashes and space — `| --- | :-: |`. */
const TABLE_DELIMITER = /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;

/**
 * The spans of `stripped` that a document split must NOT divide: fenced code blocks and GFM tables.
 *
 * The preview splices in-flow comment cards by cutting the source at the anchor line and parsing each
 * half on its own ({@link import("./MarkdownPreview")}), and half of a multi-line construct is not the
 * same document: a cut inside a fence leaves it unclosed, so the first half renders the rest of itself
 * as code and the *closing* fence in the second half opens a new block — the whole remainder of the
 * document turns into a code block. A table cut below its delimiter row loses the header its body rows
 * need and degrades to pipe-littered prose. Everything else splits into two well-formed constructs (a
 * list becomes two lists, a blockquote two quotes), which is exactly what a card between two items
 * should look like, so those are deliberately not listed here.
 *
 * A scan, not a parse: the preview must know the safe cut points *before* rendering, and this is the
 * whole of what a cut can break. An unclosed fence runs to the end of the document (CommonMark), and is
 * reported as such.
 */
export function indivisibleSpans(stripped: string): LineSpan[] {
	const lines = stripped.split("\n");
	const spans: LineSpan[] = [];
	let i = 0;
	while (i < lines.length) {
		const line = lines[i] ?? "";
		const fence = FENCE_OPEN.exec(line);
		// A backtick fence's info string may not contain a backtick — that's an inline-code line, not a
		// fence (CommonMark); a tilde fence's may.
		if (fence?.[1] && !(fence[1][0] === "`" && fence[2]?.includes("`"))) {
			const marker = fence[1];
			const close = new RegExp(`^ {0,3}\\${marker[0]}{${marker.length},}[ \t]*$`);
			let end = i + 1;
			while (end < lines.length && !close.test(lines[end] ?? "")) end++;
			spans.push({ start: i + 1, end: Math.min(end + 1, lines.length) });
			i = end + 1;
			continue;
		}
		const next = lines[i + 1];
		if (line.includes("|") && next?.includes("|") && TABLE_DELIMITER.test(next)) {
			// A GFM table runs from its header row to the first blank line (or the end of the document).
			let end = i + 2;
			while (end < lines.length && (lines[end] ?? "").trim() !== "") end++;
			spans.push({ start: i + 1, end });
			i = end;
			continue;
		}
		i++;
	}
	return spans;
}

/**
 * Move a split point forward to the end of the span it would divide — "put the card after the enclosing
 * block" — leaving a line that divides nothing exactly where it is. Monotonic, so it never reorders two
 * inserts. A split *at* a span's last line is already after the whole construct.
 */
export function snapSplitLine(spans: readonly LineSpan[], line: number): number {
	for (const span of spans) if (line >= span.start && line < span.end) return span.end;
	return line;
}

/** Nearest ancestor (inclusive) carrying a stamped line range. */
function stampedAncestor(node: Node | null, root: HTMLElement): HTMLElement | null {
	let el = node instanceof HTMLElement ? node : (node?.parentElement ?? null);
	while (el && el !== root.parentElement) {
		if (el.hasAttribute?.("data-md-line-start")) return el;
		el = el.parentElement;
	}
	return null;
}

/**
 * Resolve the current DOM selection inside a stamped rendered-markdown `container` to RAW-file lines,
 * or null when the selection doesn't touch stamped blocks — the caller falls back to its text-search
 * mapper.
 */
export function stampedSelectionLines(container: HTMLElement): LineSelection | null {
	const sel = window.getSelection();
	if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
	const range = sel.getRangeAt(0);
	const startBlock = stampedAncestor(range.startContainer, container);
	const endBlock = stampedAncestor(range.endContainer, container);
	if (!startBlock || !endBlock) return null;
	const num = (el: HTMLElement, attr: string) => Number(el.getAttribute(attr)) || 0;
	const startLine = num(startBlock, "data-md-line-start");
	// A triple-click / drag-to-boundary selection often ENDS at offset 0 of the NEXT block — nothing of
	// that block is actually selected, so the range ends at the previous stamped block instead.
	const boundaryOnly = endBlock !== startBlock && range.endOffset === 0;
	let effectiveEnd: HTMLElement = endBlock;
	if (boundaryOnly) {
		let prev = endBlock.previousElementSibling;
		while (prev && !(prev instanceof HTMLElement && prev.hasAttribute("data-md-line-start")))
			prev = prev.previousElementSibling;
		effectiveEnd = prev instanceof HTMLElement ? prev : startBlock;
	}
	const endLine = num(effectiveEnd, "data-md-line-end");
	if (startLine < 1 || endLine < 1) return null;
	return { startLine, endLine: Math.max(startLine, endLine) };
}

/**
 * Mark the stamped blocks intersecting the given RAW line ranges with `.review-region` (the preview's
 * twin of Monaco's commented-line decoration), clearing previous marks. Imperative on purpose: the
 * blocks live inside ReactMarkdown's output, out of reach of per-node props.
 */
/** The block elements the region mark applies to — inline elements (strong/em/a) are stamped too but
 * must never carry the bar (it would mark a word, not the commented block). */
const REGION_BLOCKS = "p, li, h1, h2, h3, h4, h5, h6, pre, blockquote, td, th";

export function markReviewRegions(container: HTMLElement, ranges: LineSelection[]): void {
	for (const el of container.querySelectorAll(".review-region"))
		el.classList.remove("review-region");
	if (ranges.length === 0) return;
	for (const el of container.querySelectorAll<HTMLElement>(REGION_BLOCKS)) {
		const start = Number(el.getAttribute("data-md-line-start")) || 0;
		const end = Number(el.getAttribute("data-md-line-end")) || 0;
		if (start < 1 || end < 1) continue;
		// Only leaf-most blocks: marking a nested block's ancestor too would double-bar its content.
		if (el.querySelector(REGION_BLOCKS)) continue;
		if (ranges.some((r) => start <= r.endLine && end >= r.startLine))
			el.classList.add("review-region");
	}
}
