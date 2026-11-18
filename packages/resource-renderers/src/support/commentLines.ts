import type { SourceLineRange } from "./sourceLines";

export interface EditorSelectionLines {
	startLineNumber: number;
	endLineNumber: number;
	positionLineNumber: number;
	positionColumn: number;
	isEmpty(): boolean;
}

export function commentLines(selection: EditorSelectionLines): SourceLineRange {
	if (selection.isEmpty()) {
		return { startLine: selection.positionLineNumber, endLine: selection.positionLineNumber };
	}
	const endLine =
		selection.positionColumn === 1 && selection.endLineNumber > selection.startLineNumber
			? selection.endLineNumber - 1
			: selection.endLineNumber;
	return { startLine: selection.startLineNumber, endLine };
}
