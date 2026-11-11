import { describe, expect, it } from "bun:test";
import { previewGlyph, previewSource } from "./previews";

describe("preview sources", () => {
	it("prefers a file over markdown and keeps the diff's before", () => {
		expect(previewSource({ previewFile: "a.html", previewBefore: "b.html" })).toEqual({
			kind: "file",
			path: "a.html",
			before: "b.html",
		});
		expect(previewSource({ preview: "  " })).toBeNull();
		expect(previewSource({ preview: "```mermaid\ngraph LR\n```" })).toMatchObject({
			kind: "markdown",
			diagram: true,
		});
		expect(previewSource({ preview: "plain" })).toMatchObject({ diagram: false });
	});

	it("names each kind with its own glyph", () => {
		const glyph = (target: Parameters<typeof previewSource>[0]) => {
			const source = previewSource(target);
			if (!source) throw new Error("no preview");
			return previewGlyph(source);
		};
		const kinds = [
			glyph({ previewFile: "a.html" }),
			glyph({ previewFile: "a.svg" }),
			glyph({ previewFile: "a.md" }),
			glyph({ previewFile: "a.ts" }),
			glyph({ previewFile: "a.ts", previewBefore: "b.ts" }),
			glyph({ preview: "```mermaid\ngraph LR\n```" }),
			glyph({ preview: "text" }),
		];
		expect(new Set(kinds).size).toBe(kinds.length);
	});
});
