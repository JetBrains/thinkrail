import type { LineSelection } from "./reviewGutter";

interface HastNode {
	type: string;
	tagName?: string;
	properties?: Record<string, unknown>;
	position?: { start: { line: number }; end: { line: number } };
	children?: HastNode[];
}

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

export function frontmatterOffset(raw: string, stripped: string): number {
	return Math.max(0, raw.split("\n").length - stripped.split("\n").length);
}

export interface LineSpan {
	start: number;
	end: number;
}

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const TABLE_DELIMITER = /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;

export function indivisibleSpans(stripped: string): LineSpan[] {
	const lines = stripped.split("\n");
	const spans: LineSpan[] = [];
	let i = 0;
	while (i < lines.length) {
		const line = lines[i] ?? "";
		const fence = FENCE_OPEN.exec(line);
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

export function snapSplitLine(spans: readonly LineSpan[], line: number): number {
	for (const span of spans) if (line >= span.start && line < span.end) return span.end;
	return line;
}

function stampedAncestor(node: Node | null, root: HTMLElement): HTMLElement | null {
	let el = node instanceof HTMLElement ? node : (node?.parentElement ?? null);
	while (el && el !== root.parentElement) {
		if (el.hasAttribute?.("data-md-line-start")) return el;
		el = el.parentElement;
	}
	return null;
}

export function stampedSelectionLines(container: HTMLElement): LineSelection | null {
	const sel = window.getSelection();
	if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
	const range = sel.getRangeAt(0);
	const startBlock = stampedAncestor(range.startContainer, container);
	const endBlock = stampedAncestor(range.endContainer, container);
	if (!startBlock || !endBlock) return null;
	const num = (el: HTMLElement, attr: string) => Number(el.getAttribute(attr)) || 0;
	const startLine = num(startBlock, "data-md-line-start");
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

const REGION_BLOCKS = "p, li, h1, h2, h3, h4, h5, h6, pre, blockquote, td, th";

export function markReviewRegions(container: HTMLElement, ranges: LineSelection[]): void {
	for (const el of container.querySelectorAll(".review-region"))
		el.classList.remove("review-region");
	if (ranges.length === 0) return;
	for (const el of container.querySelectorAll<HTMLElement>(REGION_BLOCKS)) {
		const start = Number(el.getAttribute("data-md-line-start")) || 0;
		const end = Number(el.getAttribute("data-md-line-end")) || 0;
		if (start < 1 || end < 1) continue;
		if (el.querySelector(REGION_BLOCKS)) continue;
		if (ranges.some((r) => start <= r.endLine && end >= r.startLine))
			el.classList.add("review-region");
	}
}
