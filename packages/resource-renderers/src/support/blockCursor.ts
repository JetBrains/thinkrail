import type { CursorCommand } from "./cursorKeys";
import type { SourceLineRange } from "./sourceLines";

export interface CursorBlock {
	start: number;
	end: number;
}

export interface BlockCursorState {
	line: number;
	anchor: number | null;
}

export type BlockCursorOutcome =
	| { kind: "state"; state: BlockCursorState }
	| { kind: "comment"; lines: SourceLineRange };

const CURSOR_BLOCKS = "p, li, h1, h2, h3, h4, h5, h6, pre, blockquote, tr";
const START = "data-md-line-start";
const END = "data-md-line-end";

function stampOf(element: Element, attribute: string): number {
	return Number(element.getAttribute(attribute)) || 0;
}

export function cursorBlockElements(container: ParentNode): HTMLElement[] {
	const candidates = Array.from(
		container.querySelectorAll<HTMLElement>(
			CURSOR_BLOCKS.split(", ")
				.map((tag) => `${tag}[${START}]`)
				.join(", "),
		),
	).filter((element) => stampOf(element, START) >= 1 && element.getClientRects().length > 0);
	return candidates.filter(
		(element) =>
			!candidates.some(
				(other) =>
					other !== element &&
					element.contains(other) &&
					stampOf(other, START) === stampOf(element, START),
			),
	);
}

interface TextNode {
	textContent: string | null;
}

export function blockText(
	element: TextNode & { localName: string; children: ArrayLike<TextNode> },
): string {
	const parts =
		element.localName === "tr"
			? Array.from(element.children, (cell) => cell.textContent)
			: [element.textContent];
	return parts.join(" ").replace(/\s+/g, " ").trim();
}

export function cursorBlocksOf(elements: readonly Element[]): CursorBlock[] {
	return elements.map((element) => {
		const start = stampOf(element, START);
		return { start, end: Math.max(start, stampOf(element, END)) };
	});
}

export function firstVisibleBlock(
	elements: readonly Element[],
	scroller: Element,
): BlockCursorState | null {
	const top = scroller.getBoundingClientRect().top;
	const element =
		elements.find((candidate) => candidate.getBoundingClientRect().bottom > top) ?? elements[0];
	const line = element ? stampOf(element, START) : 0;
	return line >= 1 ? { line, anchor: null } : null;
}

export function blockIndexAt(blocks: readonly CursorBlock[], line: number): number {
	let index = -1;
	for (const [candidate, block] of blocks.entries()) {
		if (block.start <= line) index = candidate;
		else break;
	}
	return Math.max(0, index);
}

export function blockRange(
	blocks: readonly CursorBlock[],
	state: BlockCursorState,
): { from: number; to: number } {
	const at = blockIndexAt(blocks, state.line);
	const anchor = state.anchor === null ? at : blockIndexAt(blocks, state.anchor);
	return { from: Math.min(at, anchor), to: Math.max(at, anchor) };
}

export function blockRangeLines(
	blocks: readonly CursorBlock[],
	state: BlockCursorState,
): SourceLineRange | null {
	const { from, to } = blockRange(blocks, state);
	const first = blocks[from];
	if (!first) return null;
	let endLine = first.end;
	for (const block of blocks.slice(from, to + 1)) endLine = Math.max(endLine, block.end);
	return { startLine: first.start, endLine };
}

export function blockCursorCommand(
	blocks: readonly CursorBlock[],
	state: BlockCursorState,
	command: CursorCommand,
): BlockCursorOutcome | null {
	if (blocks.length === 0) return null;
	if (command.kind === "comment") {
		const lines = blockRangeLines(blocks, state);
		return lines ? { kind: "comment", lines } : null;
	}
	if (command.kind === "escape") {
		return state.anchor === null ? null : { kind: "state", state: { ...state, anchor: null } };
	}
	const at = blockIndexAt(blocks, state.line);
	let index: number;
	if (command.kind === "edge") index = command.edge === "first" ? 0 : blocks.length - 1;
	else if (command.direction === "up" || command.direction === "down") {
		index = Math.min(blocks.length - 1, Math.max(0, at + (command.direction === "down" ? 1 : -1)));
	} else return null;
	const target = blocks[index];
	if (!target) return null;
	const current = blocks[at]?.start ?? target.start;
	return {
		kind: "state",
		state: {
			line: target.start,
			anchor: command.extend ? (state.anchor ?? current) : null,
		},
	};
}
