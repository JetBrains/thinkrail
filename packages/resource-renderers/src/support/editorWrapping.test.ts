import { expect, test } from "bun:test";
import { editorWrappingOptions } from "./editorWrapping";

test("pane-bounded file wrapping can wrap before the configured column", () => {
	expect(editorWrappingOptions(96, true)).toEqual({
		wordWrap: "bounded",
		wordWrapColumn: 96,
	});
});

test("unbounded file wrapping preserves the configured column", () => {
	expect(editorWrappingOptions(180, false)).toEqual({
		wordWrap: "wordWrapColumn",
		wordWrapColumn: 180,
	});
});
