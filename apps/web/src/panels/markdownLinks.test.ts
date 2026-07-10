import { expect, test } from "bun:test";
import { classifyHref, resolveRelativePath, slugify } from "./markdownLinks";

test("classifyHref distinguishes anchors, external, and relative targets", () => {
	expect(classifyHref(undefined)).toBe("empty");
	expect(classifyHref("")).toBe("empty");
	expect(classifyHref("#section")).toBe("anchor");
	expect(classifyHref("https://example.com")).toBe("external");
	expect(classifyHref("mailto:a@b.com")).toBe("external");
	expect(classifyHref("//cdn.example.com/x")).toBe("external");
	expect(classifyHref("./other.md")).toBe("relative");
	expect(classifyHref("../contracts/SPEC.md")).toBe("relative");
	expect(classifyHref("architecture.md")).toBe("relative");
});

test("resolveRelativePath resolves against the source file's directory (posix)", () => {
	expect(resolveRelativePath("packages/server/SPEC.md", "src/host/SPEC.md")).toBe(
		"packages/server/src/host/SPEC.md",
	);
	expect(resolveRelativePath("packages/server/SPEC.md", "../contracts/SPEC.md")).toBe(
		"packages/contracts/SPEC.md",
	);
	expect(resolveRelativePath("README.md", "architecture.md")).toBe("architecture.md");
	expect(resolveRelativePath("docs/guide.md", "./img/logo.png")).toBe("docs/img/logo.png");
	// A leading slash is worktree-root-relative.
	expect(resolveRelativePath("a/b/c.md", "/root.md")).toBe("root.md");
});

test("slugify matches GitHub-style heading anchors", () => {
	expect(slugify("Getting Started")).toBe("getting-started");
	expect(slugify("Hello, World!")).toBe("hello-world");
	expect(slugify("  Trim  Me  ")).toBe("trim-me");
});
