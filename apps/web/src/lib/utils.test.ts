import { expect, test } from "bun:test";
import { isMarkdownPath, stripFrontmatter } from "./utils";

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
