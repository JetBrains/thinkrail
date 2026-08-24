import type { editor } from "monaco-editor";

export interface LineSelection {
	startLine: number;
	endLine: number;
}

export function applyReviewDecorations(
	codeEditor: editor.ICodeEditor,
	previous: string[],
	ranges: LineSelection[],
): string[] {
	return codeEditor.deltaDecorations(
		previous,
		ranges.map((range) => ({
			range: {
				startLineNumber: range.startLine,
				startColumn: 1,
				endLineNumber: range.endLine,
				endColumn: 1,
			},
			options: {
				isWholeLine: true,
				className: "review-comment-line",
				linesDecorationsClassName: "review-comment-rail",
			},
		})),
	);
}
