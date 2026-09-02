import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Markdown } from "../chat/Markdown";
import {
	classifyHref,
	documentComponents,
	resolveRelativePath,
	slugify,
} from "./markdownLinks";

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
	expect(resolveRelativePath("a/b/c.md", "/root.md")).toBe("root.md");
});

test("relative document targets have no browser-navigable href", () => {
	const html = renderToStaticMarkup(
		createElement(Markdown, {
			text: "[`themes/SPEC.md`](../themes/SPEC.md)",
			components: documentComponents({
				workspaceId: "workspace-1",
				path: "apps/web/src/styles/COLOR.md",
			}),
		}),
	);

	expect(html).toContain('<button type="button" data-testid="markdown-file-link"');
	expect(html).toContain('data-path="apps/web/src/themes/SPEC.md"');
	expect(html).not.toContain('href="../themes/SPEC.md"');
});

test("slugify matches GitHub-style heading anchors", () => {
	expect(slugify("Getting Started")).toBe("getting-started");
	expect(slugify("Hello, World!")).toBe("hello-world");
	expect(slugify("  Trim  Me  ")).toBe("trim-me");
});
