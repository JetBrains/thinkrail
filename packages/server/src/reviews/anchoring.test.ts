import { expect, test } from "bun:test";
import type { ReviewAnchor, ReviewSelector } from "@thinkrail/contracts";
import {
	buildTextQuote,
	hashContent,
	isPositioned,
	lineRangeOf,
	reanchor,
	validateSelectors,
} from "./anchoring";

const CONTENT = ["const a = 1;", "const b = 2;", "const c = 3;", "const d = 4;"].join("\n");

function anchorFor(content: string, startLine: number, endLine: number): ReviewAnchor {
	return {
		path: "src/x.ts",
		side: "worktree",
		contentHash: hashContent(content),
		selectors: [
			{ kind: "lineRange", startLine, endLine },
			buildTextQuote(content, startLine, endLine),
		],
	};
}

test("buildTextQuote captures the exact lines + bounded context", () => {
	const quote = buildTextQuote(CONTENT, 2, 3);
	expect(quote.exact).toBe("const b = 2;\nconst c = 3;");
	expect(quote.prefix.endsWith("const a = 1;\n")).toBe(true);
	expect(quote.suffix.startsWith("\nconst d = 4;")).toBe(true);
});

test("unchanged content stays anchored", () => {
	const anchor = anchorFor(CONTENT, 2, 2);
	const result = reanchor(anchor, CONTENT);
	expect(result.state).toBe("anchored");
	expect(result.anchor).toBe(anchor);
});

test("an edit above the fragment re-pins the line range (moved)", () => {
	const anchor = anchorFor(CONTENT, 2, 3);
	const edited = `// header\n// more\n${CONTENT}`;
	const result = reanchor(anchor, edited);
	expect(result.state).toBe("moved");
	expect(lineRangeOf(result.anchor)).toEqual({ kind: "lineRange", startLine: 4, endLine: 5 });
	expect(result.anchor.contentHash).toBe(hashContent(edited));
});

test("an edited fragment goes outdated and keeps its snapshot", () => {
	const anchor = anchorFor(CONTENT, 2, 2);
	const edited = CONTENT.replace("const b = 2;", "const b = 99;");
	const result = reanchor(anchor, edited);
	expect(result.state).toBe("outdated");
	expect(result.anchor).toBe(anchor);
});

test("a deleted file goes outdated", () => {
	expect(reanchor(anchorFor(CONTENT, 1, 1), null).state).toBe("outdated");
});

test("an ambiguous fragment is disambiguated by prefix/suffix", () => {
	const dup = ["x();", "same();", "y();", "same();", "z();"].join("\n");
	const anchor: ReviewAnchor = {
		path: "a.ts",
		side: "worktree",
		contentHash: hashContent(dup),
		selectors: [{ kind: "lineRange", startLine: 4, endLine: 4 }, buildTextQuote(dup, 4, 4)],
	};
	const edited = `// top\n${dup}`;
	const result = reanchor(anchor, edited);
	expect(result.state).toBe("moved");
	expect(lineRangeOf(result.anchor)).toEqual({ kind: "lineRange", startLine: 5, endLine: 5 });
});

test("a truly ambiguous fragment (identical context) goes outdated", () => {
	const dup = ["same();", "same();"].join("\n");
	const anchor: ReviewAnchor = {
		path: "a.ts",
		side: "worktree",
		contentHash: "stale",
		selectors: [
			{ kind: "lineRange", startLine: 1, endLine: 1 },
			{ kind: "textQuote", exact: "same();", prefix: "", suffix: "" },
		],
	};
	expect(reanchor(anchor, dup).state).toBe("outdated");
});

test("a file-level anchor on changed content is moved with a refreshed hash, never outdated", () => {
	const anchor: ReviewAnchor = {
		path: "a.ts",
		side: "worktree",
		contentHash: hashContent(CONTENT),
		selectors: [],
	};
	const edited = `${CONTENT}\n// more`;
	const result = reanchor(anchor, edited);
	expect(result.state).toBe("moved");
	expect(result.anchor.contentHash).toBe(hashContent(edited));
});

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02]);

function regionAnchor(bytes: Uint8Array): ReviewAnchor {
	return {
		path: "docs/arch.png",
		side: "worktree",
		contentHash: hashContent(bytes),
		selectors: [{ kind: "region", x: 0.12, y: 0.4, width: 0.3, height: 0.1 }],
	};
}

test("a byte-only resource re-anchors on its bytes: equal → anchored, gone → outdated", () => {
	const anchor = regionAnchor(PNG);
	expect(reanchor(anchor, PNG).state).toBe("anchored");
	expect(reanchor(anchor, null).state).toBe("outdated");
});

test("a changed byte-only resource is outdated, never re-pinned — a region has no evidence to move by", () => {
	const anchor = regionAnchor(PNG);
	const result = reanchor(anchor, new Uint8Array([...PNG, 0x03]));
	expect(result.state).toBe("outdated");
	expect(result.anchor).toBe(anchor);
	expect(result.anchor.contentHash).toBe(hashContent(PNG));
});

test("a positioned TEXT anchor with no textQuote goes outdated on a hash change", () => {
	const anchor: ReviewAnchor = {
		path: "notes.ipynb",
		side: "worktree",
		contentHash: hashContent(CONTENT),
		selectors: [{ kind: "structural", scheme: "ipynb-cell", ref: "a1b2" }],
	};
	const result = reanchor(anchor, `${CONTENT}\n// more`);
	expect(result.state).toBe("outdated");
	expect(result.anchor).toBe(anchor);
});

test("a structural anchor that also carries text selectors moves with its cell", () => {
	const anchor: ReviewAnchor = {
		path: "notes.ipynb",
		side: "worktree",
		contentHash: hashContent(CONTENT),
		selectors: [
			{ kind: "structural", scheme: "ipynb-cell", ref: "a1b2" },
			{ kind: "lineRange", startLine: 2, endLine: 2 },
			buildTextQuote(CONTENT, 2, 2),
		],
	};
	const edited = `// a new cell above\n${CONTENT}`;
	const result = reanchor(anchor, edited);
	expect(result.state).toBe("moved");
	expect(lineRangeOf(result.anchor)).toEqual({ kind: "lineRange", startLine: 3, endLine: 3 });
	expect(result.anchor.selectors[0]).toEqual({
		kind: "structural",
		scheme: "ipynb-cell",
		ref: "a1b2",
	});
});

test("isPositioned: a line range, cell or region names a position; a quote or hunk alone does not", () => {
	const anchor = (selectors: ReviewSelector[]): ReviewAnchor => ({
		path: "a.ts",
		side: "worktree",
		selectors,
	});
	expect(isPositioned(anchor([{ kind: "lineRange", startLine: 1, endLine: 1 }]))).toBe(true);
	expect(isPositioned(anchor([{ kind: "structural", scheme: "json-pointer", ref: "/a/0" }]))).toBe(
		true,
	);
	expect(isPositioned(anchor([{ kind: "region", x: 0, y: 0, width: 1, height: 1, page: 2 }]))).toBe(
		true,
	);
	expect(isPositioned(anchor([buildTextQuote(CONTENT, 1, 1)]))).toBe(false);
	expect(isPositioned(anchor([{ kind: "diffHunk", hunkHeader: "@@ -1 +1 @@" }]))).toBe(false);
	expect(isPositioned(anchor([]))).toBe(false);
});

test("validateSelectors accepts a well-formed rich selector set", () => {
	expect(() =>
		validateSelectors([
			{ kind: "region", x: 0, y: 0.4, width: 1, height: 0.1, page: 3 },
			{ kind: "structural", scheme: "table-cell", ref: "7:2" },
			{ kind: "structural", scheme: "renderer-defined-scheme", ref: "anything" },
			{ kind: "lineRange", startLine: 1, endLine: 1 },
			buildTextQuote(CONTENT, 1, 1),
			{ kind: "diffHunk", hunkHeader: "@@ -1 +1 @@" },
		]),
	).not.toThrow();
});

test("validateSelectors rejects out-of-range geometry, bad schemes, empty refs and inverted ranges", () => {
	expect(() =>
		validateSelectors([{ kind: "region", x: 1.2, y: 0, width: 0.1, height: 0.1 }]),
	).toThrow(/x must be a fraction in \[0, 1\]/);
	expect(() =>
		validateSelectors([{ kind: "region", x: 0, y: -0.1, width: 0.1, height: 0.1 }]),
	).toThrow(/y must be a fraction/);
	expect(() =>
		validateSelectors([{ kind: "region", x: 0, y: 0, width: Number.NaN, height: 0.1 }]),
	).toThrow(/width must be a fraction/);
	expect(() => validateSelectors([{ kind: "region", x: 0, y: 0, width: 0.1, height: 2 }])).toThrow(
		/height must be a fraction/,
	);
	expect(() =>
		validateSelectors([{ kind: "region", x: 0, y: 0, width: 0.1, height: 0.1, page: 0 }]),
	).toThrow(/page must be a positive integer/);
	expect(() =>
		validateSelectors([{ kind: "region", x: 0, y: 0, width: 0.1, height: 0.1, page: 1.5 }]),
	).toThrow(/page must be a positive integer/);
	expect(() =>
		validateSelectors([{ kind: "structural", scheme: "JSON-Pointer", ref: "/a" }]),
	).toThrow(/scheme must match/);
	expect(() => validateSelectors([{ kind: "structural", scheme: "ipynb-cell", ref: "" }])).toThrow(
		/non-empty ref/,
	);
	expect(() => validateSelectors([{ kind: "lineRange", startLine: 0, endLine: 3 }])).toThrow(
		/from line 1 onwards/,
	);
	expect(() => validateSelectors([{ kind: "lineRange", startLine: 9, endLine: 3 }])).toThrow(
		/from line 1 onwards/,
	);
	expect(() => validateSelectors([{ kind: "lineRange", startLine: 1.5, endLine: 3 }])).toThrow(
		/must be integers/,
	);
});

test("validateSelectors returns the narrowed selectors, keeping only the fields the union declares", () => {
	expect(
		validateSelectors([
			{ kind: "region", x: 0, y: 0.5, width: 1, height: 0.25, page: 2, rotation: 90 },
			{ kind: "structural", scheme: "json-pointer", ref: "/a/0", cellId: "a1b2" },
			{ kind: "lineRange", startLine: 3, endLine: 4, column: 7 },
		]),
	).toEqual([
		{ kind: "region", x: 0, y: 0.5, width: 1, height: 0.25, page: 2 },
		{ kind: "structural", scheme: "json-pointer", ref: "/a/0" },
		{ kind: "lineRange", startLine: 3, endLine: 4 },
	]);
});

test("validateSelectors refuses raw wire shapes a compile-time type would have assumed", () => {
	expect(() => validateSelectors([{ kind: "structural", ref: "/a" }])).toThrow(/scheme must match/);
	expect(() =>
		validateSelectors([{ kind: "structural", scheme: "json-pointer", ref: 42 }]),
	).toThrow(/non-empty ref/);
	expect(() => validateSelectors([{ kind: "squiggle", at: 3 }])).toThrow(/Unknown selector kind/);
	expect(() => validateSelectors({ kind: "lineRange", startLine: 1, endLine: 1 })).toThrow(
		/selectors must be an array/,
	);
	expect(() => validateSelectors(undefined)).toThrow(/selectors must be an array/);
	expect(() => validateSelectors(["lineRange"])).toThrow(/selector must be an object/);
	expect(() => validateSelectors([null])).toThrow(/selector must be an object/);
	expect(() =>
		validateSelectors([{ kind: "region", x: "0.1", y: 0, width: 0.1, height: 0.1 }]),
	).toThrow(/x must be a fraction/);
	expect(() => validateSelectors([{ kind: "lineRange", startLine: "2", endLine: 2 }])).toThrow(
		/must be integers/,
	);
	expect(() =>
		validateSelectors([{ kind: "textQuote", exact: "a", prefix: "", suffix: null }]),
	).toThrow(/textQuote selector needs string/);
	expect(() => validateSelectors([{ kind: "diffHunk", hunkHeader: 7 }])).toThrow(
		/string hunkHeader/,
	);
});
