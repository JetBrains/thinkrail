import { expect, test } from "bun:test";
import {
	cssColorToHex,
	hasPlatformModifier,
	isAbsolutePath,
	isMarkdownPath,
	normalizePath,
	platformShortcutLabel,
	projectRelativePath,
	shallowEqualArrays,
	stripFrontmatter,
} from "./utils";

test("platform shortcuts use Ctrl outside an Apple browser environment", () => {
	expect(platformShortcutLabel("B")).toBe("Ctrl+B");
	expect(hasPlatformModifier({ ctrlKey: true, metaKey: false })).toBe(true);
	expect(hasPlatformModifier({ ctrlKey: false, metaKey: true })).toBe(false);
	expect(hasPlatformModifier({ ctrlKey: true, metaKey: true })).toBe(false);
});

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

test("normalizePath brings both separator styles to one form and drops a leading ./", () => {
	expect(normalizePath("src/foo.ts")).toBe("src/foo.ts");
	expect(normalizePath("C:\\wt\\src\\foo.ts")).toBe("C:/wt/src/foo.ts");
	// The `./` strip is a *comparison* concern, not cosmetics: pi reports this form, and without it the
	// path matches neither a Changes entry nor a spec-graph node.
	expect(normalizePath("./src/foo.ts")).toBe("src/foo.ts");
	expect(normalizePath(".//src/foo.ts")).toBe("src/foo.ts");
	expect(normalizePath(".\\src\\foo.ts")).toBe("src/foo.ts");
	// A bare "." is a path, not a prefix — left alone.
	expect(normalizePath(".")).toBe(".");
	expect(normalizePath("../src/foo.ts")).toBe("../src/foo.ts");
});

test("projectRelativePath yields the worktree-relative tab identity from every reported form", () => {
	const root = "/wt/ws";
	expect(projectRelativePath("src/foo.ts", root)).toBe("src/foo.ts");
	expect(projectRelativePath("./src/foo.ts", root)).toBe("src/foo.ts");
	expect(projectRelativePath("/wt/ws/src/foo.ts", root)).toBe("src/foo.ts");
	expect(projectRelativePath("/wt/ws/src/foo.ts", `${root}/`)).toBe("src/foo.ts"); // trailing slash
	// One file, one identity: every form above collapses to the same string, which is what keeps
	// `openFileInTab` from opening a second tab for an already-open file.
	// Outside the root (or with no root known) it stays as reported — the read then fails loudly.
	expect(projectRelativePath("/elsewhere/foo.ts", root)).toBe("/elsewhere/foo.ts");
	expect(projectRelativePath("/wt/ws/src/foo.ts")).toBe("/wt/ws/src/foo.ts");
});

test("isAbsolutePath accepts posix and Windows roots, in either separator style", () => {
	expect(isAbsolutePath("/wt/src/foo.ts")).toBe(true);
	expect(isAbsolutePath("C:/wt/foo.ts")).toBe(true);
	expect(isAbsolutePath("C:\\wt\\foo.ts")).toBe(true); // normalized before the test
	expect(isAbsolutePath("src/foo.ts")).toBe(false);
	expect(isAbsolutePath("./src/foo.ts")).toBe(false);
	expect(isAbsolutePath("")).toBe(false);
});

test("shallowEqualArrays compares element-wise and treats absent as unequal", () => {
	const same = ["a", "b"];
	expect(shallowEqualArrays(same, same)).toBe(true); // identity short-circuit
	expect(shallowEqualArrays(["a", "b"], ["a", "b"])).toBe(true);
	expect(shallowEqualArrays(["a", "b"], ["a", "c"])).toBe(false);
	expect(shallowEqualArrays(["a"], ["a", "b"])).toBe(false);
	expect(shallowEqualArrays([], [])).toBe(true);
	// `Object.is`, so a NaN key equals itself — the reason it isn't `===`.
	expect(shallowEqualArrays([Number.NaN], [Number.NaN])).toBe(true);
	expect(shallowEqualArrays(undefined, [])).toBe(false);
	expect(shallowEqualArrays(undefined, undefined)).toBe(true);
});
