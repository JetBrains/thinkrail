import type { editor } from "monaco-editor/editor/editor.api.js";

export function editorWrappingOptions(
	lineWidth: number,
	bounded: boolean,
): Pick<editor.IStandaloneEditorConstructionOptions, "wordWrap" | "wordWrapColumn"> {
	return {
		wordWrap: bounded ? "bounded" : "wordWrapColumn",
		wordWrapColumn: lineWidth,
	};
}
