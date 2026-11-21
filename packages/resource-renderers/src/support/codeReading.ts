import type { ReadingDirection } from "@thinkrail/ui/reading";

export interface VisibleLines {
	readonly startLineNumber: number;
	readonly endLineNumber: number;
}

export function readingAnchorLine(
	caret: number,
	visible: readonly VisibleLines[],
	direction: ReadingDirection,
): number | null {
	const first = visible[0];
	const last = visible.at(-1);
	if (!first || !last) return null;
	if (visible.some((lines) => caret >= lines.startLineNumber && caret <= lines.endLineNumber)) {
		return null;
	}
	return direction > 0 ? first.startLineNumber : last.endLineNumber;
}
