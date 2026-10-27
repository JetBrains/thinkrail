import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TestMarkdown as Markdown } from "../testing/markdown";
import { stripFrontmatter } from "./frontmatter";
import { documentRehypePlugins } from "./markdownHtml";
import { remarkHeadingIds } from "./markdownLinks";
import {
	activeHeadingId,
	extractMarkdownOutline,
	flattenOutlineHeadings,
	nestOutlineHeadings,
	scrollHeadingIntoView,
} from "./outlineHeadings";

function ids(markdown: string): string[] {
	return flattenOutlineHeadings(extractMarkdownOutline(markdown)).map((entry) => entry.heading.id);
}

function renderHeadings(markdown: string): string {
	return renderToStaticMarkup(
		createElement(Markdown, {
			text: stripFrontmatter(markdown),
			remarkPlugins: [remarkHeadingIds],
			rehypePlugins: documentRehypePlugins(),
		}),
	);
}

test("nests headings under the nearest shallower level, including skipped levels", () => {
	const tree = extractMarkdownOutline(`# One

## Two

#### Four

### Three

## Two-b

# Other
`);
	expect(tree.map((node) => node.text)).toEqual(["One", "Other"]);
	expect(tree[0]?.children.map((node) => node.text)).toEqual(["Two", "Two-b"]);
	expect(tree[0]?.children[0]?.children.map((node) => node.text)).toEqual(["Four", "Three"]);
	expect(nestOutlineHeadings([{ depth: 3, text: "Lonely", id: "lonely" }])).toEqual([
		{ depth: 3, text: "Lonely", id: "lonely", children: [] },
	]);
	const skipped = extractMarkdownOutline("# One\n\n### Three\n");
	expect(skipped[0]?.children.map((node) => node.text)).toEqual(["Three"]);
	expect(
		flattenOutlineHeadings(extractMarkdownOutline("# One\n\n## Two\n")).map(
			(entry) => entry.heading.text,
		),
	).toEqual(["One", "Two"]);
});

test("duplicate heading text reuses the renderer's slug numbering", () => {
	expect(ids("# Intro\n\n# Intro\n\n# Intro")).toEqual(["intro", "intro-1", "intro-2"]);
});

test("frontmatter is not a heading source", () => {
	const markdown = "---\ntitle: Not a heading\n---\n\n# Real\n\n## Nested\n";
	expect(stripFrontmatter(markdown)).not.toContain("title:");
	expect(
		flattenOutlineHeadings(extractMarkdownOutline(markdown)).map((entry) => entry.heading.text),
	).toEqual(["Real", "Nested"]);
});

test("headings inside fenced code are omitted", () => {
	expect(
		ids(`# Visible

\`\`\`
# Fenced
\`\`\`

~~~md
## Also fenced
~~~

## Still visible
`),
	).toEqual(["visible", "still-visible"]);
});

test("setext headings are collected at their underline level", () => {
	const tree = extractMarkdownOutline(`Alpha
=====

Beta
----

# Gamma
`);
	expect(
		flattenOutlineHeadings(tree).map((entry) => [
			entry.heading.depth,
			entry.heading.text,
			entry.heading.id,
		]),
	).toEqual([
		[1, "Alpha", "alpha"],
		[2, "Beta", "beta"],
		[1, "Gamma", "gamma"],
	]);
});

test("inline formatting and links contribute plain text to labels and ids", () => {
	const [heading] = flattenOutlineHeadings(
		extractMarkdownOutline("# Hello **world** and [docs](https://example.com)\n\n## Next\n"),
	);
	expect(heading?.heading.text).toBe("Hello world and docs");
	expect(heading?.heading.id).toBe("hello-world-and-docs");
});

test("outline ids match the ids the renderer stamps on headings", () => {
	const markdown = `---
id: skip
---

# Hello **world**

## Hello **world**

\`\`\`
# fenced
\`\`\`

Title
=====

[Link *me*](/x)
---------------
`;
	const html = renderHeadings(markdown);
	for (const id of ids(markdown)) {
		expect(html).toContain(`id="user-content-${id}"`);
	}
	expect(html).not.toContain("user-content-fenced");
	expect(html).not.toContain("user-content-skip");
});

test("scrollHeadingIntoView scrolls the preview scroller, not the window", () => {
	const calls: { top: number; behavior?: ScrollBehavior }[] = [];
	const heading = {
		getBoundingClientRect: () => ({ top: 400 }),
	};
	const scroller = {
		scrollTop: 50,
		getBoundingClientRect: () => ({ top: 100 }),
		querySelector: (selector: string) => (selector.includes("section-two") ? heading : null),
		scrollTo: (options: { top: number }) => {
			calls.push(options);
		},
	};
	scrollHeadingIntoView(scroller as unknown as HTMLElement, "section-two");
	expect(calls).toEqual([{ top: 350, behavior: "smooth" }]);
});

test("activeHeadingId is the last heading at or above the viewport top", () => {
	const tops: Record<string, number> = {
		one: 0,
		two: 200,
		three: 500,
	};
	const scroller = {
		getBoundingClientRect: () => ({ top: 0 }),
		querySelector: (selector: string) => {
			const match = /\[id="(?:user-content-)?([^"]+)"\]/.exec(selector);
			const top = match ? tops[match[1] ?? ""] : undefined;
			return top === undefined ? null : { getBoundingClientRect: () => ({ top }) };
		},
	} as unknown as HTMLElement;
	expect(activeHeadingId(scroller, ["one", "two", "three"])).toBe("one");
	tops.one = -10;
	tops.two = 0;
	tops.three = 40;
	expect(activeHeadingId(scroller, ["one", "two", "three"])).toBe("two");
	tops.two = -2;
	tops.three = 0;
	expect(activeHeadingId(scroller, ["one", "two", "three"])).toBe("three");
});
