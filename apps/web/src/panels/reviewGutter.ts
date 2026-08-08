// The shared Monaco half of review mode (see panels/SPEC.md): line decorations for existing comments
// and the selection→line-range plumbing FilePane/DiffPane feed the comment strip with. Lives in the
// lazy Monaco chunk's dependency set — only the panes that already load Monaco import it.

import type { editor } from "monaco-editor";

/** A 1-based inclusive line selection, as the comment strip consumes it. */
export interface LineSelection {
	startLine: number;
	endLine: number;
}

/** Replace an editor's review decorations with the given ranges; returns the new decoration ids. */
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
