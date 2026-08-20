import { expect, test } from "bun:test";
import {
	cssColorToHex,
	hasPlatformModifier,
	isAbsolutePath,
	isMarkdownPath,
	layoutResourceIdentity,
	normalizePath,
	parseTupleKey,
	platformShortcutLabel,
	projectRelativePath,
	shallowEqualArrays,
	stripFrontmatter,
	tupleKey,
} from "./utils";

test("platform shortcuts use Ctrl on non-Apple platforms", () => {
	const platform = "Linux x86_64";
	expect(platformShortcutLabel("B", platform)).toBe("Ctrl+B");
	expect(hasPlatformModifier({ ctrlKey: true, metaKey: false }, platform)).toBe(true);
	expect(hasPlatformModifier({ ctrlKey: false, metaKey: true }, platform)).toBe(false);
	expect(hasPlatformModifier({ ctrlKey: true, metaKey: true }, platform)).toBe(false);
});

test("platform shortcuts use Command on Apple platforms", () => {
	const platform = "MacIntel";
	expect(platformShortcutLabel("B", platform)).toBe("⌘B");
	expect(hasPlatformModifier({ ctrlKey: false, metaKey: true }, platform)).toBe(true);
	expect(hasPlatformModifier({ ctrlKey: true, metaKey: false }, platform)).toBe(false);
	expect(hasPlatformModifier({ ctrlKey: true, metaKey: true }, platform)).toBe(false);
});

test("isMarkdownPath matches .md/.markdown case-insensitively, nothing else", () => {
	expect(isMarkdownPath("README.md")).toBe(true);
	expect(isMarkdownPath("docs/GUIDE.MARKDOWN")).toBe(true);
	expect(isMarkdownPath("a/b/notes.Md")).toBe(true);
	expect(isMarkdownPath("index.ts")).toBe(false);
	expect(isMarkdownPath("notes.txt")).toBe(false);
	expect(isMarkdownPath("mdfile")).toBe(false);
	expect(isMarkdownPath("weird.md.ts")).toBe(false);
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
	expect(stripFrontmatter("intro\n---\nid: x\n---\n")).toBe("intro\n---\nid: x\n---\n");
});

test("cssColorToHex expands short hex and passes full hex through", () => {
	expect(cssColorToHex("#fff")).toBe("#ffffff");
	expect(cssColorToHex("#FfF")).toBe("#FFffFF");
	expect(cssColorToHex("#abc4")).toBe("#aabbcc44");
	expect(cssColorToHex("#ffffff")).toBe("#ffffff");
	expect(cssColorToHex("#a9b7c6")).toBe("#a9b7c6");
	expect(cssColorToHex(" #2b2b2b ")).toBe("#2b2b2b");
});

test("cssColorToHex reads unparseable values as unset", () => {
	expect(cssColorToHex("")).toBe("");
	expect(cssColorToHex("not-a-color")).toBe("");
});

test("tuple keys keep delimiter-bearing identity tuples distinct and parse only their namespace", () => {
	const first = tupleKey("resource", "a:b", "c");
	const second = tupleKey("resource", "a", "b:c");
	expect(first).not.toBe(second);
	expect(parseTupleKey(first, "resource")).toEqual(["a:b", "c"]);
	expect(parseTupleKey(first, "other")).toBeNull();
	expect(parseTupleKey("resource:not-json", "resource")).toBeNull();
});

test("layout resource identity ignores placement ids and separates delimiter-bearing diff tuples", () => {
	expect(layoutResourceIdentity({ kind: "file", id: "one", name: "One", path: "src/a:b.ts" })).toBe(
		layoutResourceIdentity({ kind: "file", id: "two", name: "Two", path: "src/a:b.ts" }),
	);
	expect(
		layoutResourceIdentity({
			kind: "diff",
			id: "one",
			name: "One",
			path: "a",
			scope: { kind: "commit", sha: "x:commit:y" },
		}),
	).not.toBe(
		layoutResourceIdentity({
			kind: "diff",
			id: "two",
			name: "Two",
			path: "a:commit:x",
			scope: { kind: "commit", sha: "y" },
		}),
	);
});

test("normalizePath brings both separator styles to one form and drops a leading ./", () => {
	expect(normalizePath("src/foo.ts")).toBe("src/foo.ts");
	expect(normalizePath("C:\\wt\\src\\foo.ts")).toBe("C:/wt/src/foo.ts");
	expect(normalizePath("./src/foo.ts")).toBe("src/foo.ts");
	expect(normalizePath(".//src/foo.ts")).toBe("src/foo.ts");
	expect(normalizePath(".\\src\\foo.ts")).toBe("src/foo.ts");
	expect(normalizePath(".")).toBe(".");
	expect(normalizePath("../src/foo.ts")).toBe("../src/foo.ts");
});

test("projectRelativePath yields the worktree-relative tab identity from every reported form", () => {
	const root = "/wt/ws";
	expect(projectRelativePath("src/foo.ts", root)).toBe("src/foo.ts");
	expect(projectRelativePath("./src/foo.ts", root)).toBe("src/foo.ts");
	expect(projectRelativePath("/wt/ws/src/foo.ts", root)).toBe("src/foo.ts");
	expect(projectRelativePath("/wt/ws/src/foo.ts", `${root}/`)).toBe("src/foo.ts");
	expect(projectRelativePath("/wt/ws/src/../foo.ts", root)).toBe("foo.ts");
	expect(projectRelativePath("src/./nested/../foo.ts", root)).toBe("src/foo.ts");
	expect(projectRelativePath("../outside.ts", root)).toBe("../outside.ts");
	expect(projectRelativePath("C:\\wt\\ws\\src\\..\\foo.ts", "C:\\wt\\ws")).toBe("foo.ts");
	expect(projectRelativePath("/src/foo.ts", "/")).toBe("src/foo.ts");
	expect(projectRelativePath("C:/src/foo.ts", "C:/")).toBe("src/foo.ts");
	expect(projectRelativePath("/elsewhere/foo.ts", root)).toBe("/elsewhere/foo.ts");
	expect(projectRelativePath("/wt/ws/src/foo.ts")).toBe("/wt/ws/src/foo.ts");
});

test("isAbsolutePath accepts posix and Windows roots, in either separator style", () => {
	expect(isAbsolutePath("/wt/src/foo.ts")).toBe(true);
	expect(isAbsolutePath("C:/wt/foo.ts")).toBe(true);
	expect(isAbsolutePath("C:\\wt\\foo.ts")).toBe(true);
	expect(isAbsolutePath("src/foo.ts")).toBe(false);
	expect(isAbsolutePath("./src/foo.ts")).toBe(false);
	expect(isAbsolutePath("")).toBe(false);
});

test("shallowEqualArrays compares element-wise and treats absent as unequal", () => {
	const same = ["a", "b"];
	expect(shallowEqualArrays(same, same)).toBe(true);
	expect(shallowEqualArrays(["a", "b"], ["a", "b"])).toBe(true);
	expect(shallowEqualArrays(["a", "b"], ["a", "c"])).toBe(false);
	expect(shallowEqualArrays(["a"], ["a", "b"])).toBe(false);
	expect(shallowEqualArrays([], [])).toBe(true);
	expect(shallowEqualArrays([Number.NaN], [Number.NaN])).toBe(true);
	expect(shallowEqualArrays(undefined, [])).toBe(false);
	expect(shallowEqualArrays(undefined, undefined)).toBe(true);
});
