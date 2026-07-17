import { expect, test } from "bun:test";
import { cssColorToHex, isMarkdownPath, stripFrontmatter } from "./utils";

test("isMarkdownPath matches .md/.markdown case-insensitively, nothing else", () => {
	expect(isMarkdownPath("README.md")).toBe(true);
	expect(isMarkdownPath("docs/GUIDE.MARKDOWN")).toBe(true);
	expect(isMarkdownPath("a/b/notes.Md")).toBe(true);
	expect(isMarkdownPath("index.ts")).toBe(false);
	expect(isMarkdownPath("notes.txt")).toBe(false);
	expect(isMarkdownPath("mdfile")).toBe(false); // no extension
	expect(isMarkdownPath("weird.md.ts")).toBe(false); // .md not the final ext
});

test("stripFrontmatter drops a leading YAML block, keeping the body", () => {
	const doc = "---\nid: x\ntitle: X\n---\n\n# Heading\n\nbody\n";
	expect(stripFrontmatter(doc)).toBe("\n# Heading\n\nbody\n");
});

test("stripFrontmatter handles a `...` close and CRLF newlines", () => {
	expect(stripFrontmatter("---\nid: x\n...\nbody")).toBe("body");
	expect(stripFrontmatter("---\r\nid: x\r\n---\r\nbody")).toBe("body");
});

test("stripFrontmatter leaves content without frontmatter untouched", () => {
	expect(stripFrontmatter("# Heading\n\nbody")).toBe("# Heading\n\nbody");
	// A `---` that isn't the very first line is a thematic break, not frontmatter.
	expect(stripFrontmatter("intro\n---\nid: x\n---\n")).toBe("intro\n---\nid: x\n---\n");
});

test("cssColorToHex expands short hex and passes full hex through", () => {
	expect(cssColorToHex("#fff")).toBe("#ffffff");
	expect(cssColorToHex("#FfF")).toBe("#FFffFF"); // case-preserving; hex is case-insensitive anyway
	expect(cssColorToHex("#abc4")).toBe("#aabbcc44");
	expect(cssColorToHex("#ffffff")).toBe("#ffffff");
	expect(cssColorToHex("#a9b7c6")).toBe("#a9b7c6");
	expect(cssColorToHex(" #2b2b2b ")).toBe("#2b2b2b");
});

test("cssColorToHex reads unparseable values as unset", () => {
	// Non-hex forms (`gray`, `rgb(…)`) canonicalize through a canvas — DOM-only, covered by the theme
	// e2e spec. Under bun (no DOM) they fall back to "" (unset), same as genuinely invalid input.
	expect(cssColorToHex("")).toBe("");
	expect(cssColorToHex("not-a-color")).toBe("");
});
