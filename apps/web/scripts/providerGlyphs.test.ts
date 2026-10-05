import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PROVIDER_GLYPH_SLUGS, readGlyphPaths, renderGlyphsModule } from "./providerGlyphs";

describe("provider glyph pipeline", () => {
	test("every mapped slug resolves to a path-only 24×24 monochrome icon in the vendored set", () => {
		for (const slug of new Set(Object.values(PROVIDER_GLYPH_SLUGS))) {
			const paths = readGlyphPaths(slug);
			expect(paths.length).toBeGreaterThan(0);
			for (const path of paths) expect(path.d.length).toBeGreaterThan(10);
		}
	});

	test("the rendered module is sorted by provider id and shares one glyph per slug", () => {
		const out = renderGlyphsModule({ b: "x", a: "x", c: "y" }, (slug) => [{ d: `M${slug}` }]);
		expect(out).toContain('const glyph_x: readonly ProviderGlyphPath[] = [{"d":"Mx"}];');
		expect(out).toContain('"a": glyph_x,\n\t"b": glyph_x,\n\t"c": glyph_y,');
		expect(out.startsWith("// GENERATED")).toBe(true);
	});

	test("coloured, oddly sized or non-path svgs are rejected rather than silently flattened", () => {
		const dir = mkdtempSync(join(tmpdir(), "glyphs-"));
		writeFileSync(
			join(dir, "layered.svg"),
			'<svg fill="currentColor" viewBox="0 0 24 24"><path d="M1" fill-opacity=".5"></path><path d="M2"></path></svg>',
		);
		writeFileSync(join(dir, "big.svg"), '<svg viewBox="0 0 48 48"><path d="M1"/></svg>');
		writeFileSync(join(dir, "shape.svg"), '<svg viewBox="0 0 24 24"><circle r="2"/></svg>');
		writeFileSync(
			join(dir, "tinted.svg"),
			'<svg viewBox="0 0 24 24"><path d="M1" fill="#f00"/></svg>',
		);
		expect(readGlyphPaths("layered", dir)).toEqual([{ d: "M1", opacity: 0.5 }, { d: "M2" }]);
		expect(() => readGlyphPaths("big", dir)).toThrow("24×24");
		expect(() => readGlyphPaths("shape", dir)).toThrow("other than <path>");
		expect(() => readGlyphPaths("tinted", dir)).toThrow("own colours");
	});
});
