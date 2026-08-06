import { expect, test } from "bun:test";
import { mapPreviewSelection, normalizeFragment } from "./previewAnchor";

const SOURCE = [
	"# Title",
	"",
	"A paragraph with **bold** text and a [link](https://x.dev) inside it.",
	"",
	"- item one",
	"- item two with `code` in it",
	"",
	"Final paragraph, plain and long enough to anchor.",
].join("\n");

test("normalizeFragment strips the markers rendering removes", () => {
	expect(normalizeFragment("A paragraph with **bold** text")).toBe("a paragraph with bold text");
	expect(normalizeFragment("item two with `code` in it")).toBe("item two with code in it");
	expect(normalizeFragment("[link](https://x.dev)")).toBe("linkhttps://x.dev");
});

test("maps a rendered paragraph selection to its source line despite markers", () => {
	// What the user selects in the PREVIEW: rendered text, markers gone.
	expect(mapPreviewSelection(SOURCE, "A paragraph with bold text and a")).toEqual({
		startLine: 3,
		endLine: 3,
	});
	expect(mapPreviewSelection(SOURCE, "item two with code in it")).toEqual({
		startLine: 6,
		endLine: 6,
	});
});

test("a selection spanning blocks maps head→start line, tail→end line", () => {
	const selected = "item one item two with code in it Final paragraph, plain and long";
	expect(mapPreviewSelection(SOURCE, selected)).toEqual({ startLine: 5, endLine: 8 });
});

test("an unmappable selection returns null (caller degrades to a whole-file comment)", () => {
	expect(mapPreviewSelection(SOURCE, "text that appears nowhere in the document")).toBeNull();
	expect(mapPreviewSelection(SOURCE, "   ")).toBeNull();
});
