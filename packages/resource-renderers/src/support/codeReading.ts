import type { ReadingDirection } from "@thinkrail/ui/reading";

export interface CodePosition {
	readonly lineNumber: number;
	readonly column: number;
}

export interface VisibleCode {
	readonly startLineNumber: number;
	readonly startColumn: number;
	readonly endLineNumber: number;
	readonly endColumn: number;
}

function before(a: CodePosition, b: CodePosition): boolean {
	return a.lineNumber < b.lineNumber || (a.lineNumber === b.lineNumber && a.column < b.column);
}

function shownSpan(range: VisibleCode, lineEnd: (lineNumber: number) => number) {
	const wrapsOn = range.endColumn < lineEnd(range.endLineNumber);
	return {
		first: { lineNumber: range.startLineNumber, column: range.startColumn },
		last: {
			lineNumber: range.endLineNumber,
			column: wrapsOn ? range.endColumn - 1 : range.endColumn,
		},
	};
}

export function readingAnchor(
	caret: CodePosition,
	visible: readonly VisibleCode[],
	direction: ReadingDirection,
	lineEnd: (lineNumber: number) => number,
): CodePosition | null {
	const spans = visible.map((range) => shownSpan(range, lineEnd));
	const top = spans[0];
	const bottom = spans.at(-1);
	if (!top || !bottom) return null;
	if (spans.some(({ first, last }) => !before(caret, first) && !before(last, caret))) return null;
	return direction > 0 ? top.first : bottom.last;
}
