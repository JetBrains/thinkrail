import { expect, test } from "bun:test";
import type { ReviewAnchor } from "@thinkrail/contracts";
import { buildTextQuote, hashContent, lineRangeOf, reanchor } from "./anchoring";

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
	// The anchor (incl. its creation-time exact fragment) is untouched.
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
	// Two occurrences with identical surroundings: prefix/suffix can't break the tie.
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

test("a file-level anchor on changed content is moved (still present), never outdated", () => {
	const anchor: ReviewAnchor = {
		path: "a.ts",
		side: "worktree",
		contentHash: hashContent(CONTENT),
		selectors: [],
	};
	const result = reanchor(anchor, `${CONTENT}\n// more`);
	expect(result.state).toBe("moved");
});
