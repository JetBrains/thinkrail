import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TestMarkdown as Markdown } from "../testing/markdown";
import { stripFrontmatter } from "./frontmatter";
import { documentRehypePlugins } from "./markdownHtml";
import { headingIdPlugin, remarkHeadingIds } from "./markdownLinks";
import {
	activeHeadingId,
	extractMarkdownOutline,
	flattenOutlineHeadings,
	headingIdsInSlice,
	nestOutlineHeadings,
	scrollHeadingIntoView,
} from "./outlineHeadings";

function ids(markdown: string): string[] {
	return flattenOutlineHeadings(extractMarkdownOutline(markdown)).map((entry) => entry.heading.id);
}

function renderHeadings(markdown: string, ids?: Parameters<typeof headingIdPlugin>[0]): string {
	return renderToStaticMarkup(
		createElement(Markdown, {
			text: stripFrontmatter(markdown),
			remarkPlugins: [ids ? headingIdPlugin(ids) : remarkHeadingIds],
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
	expect(nestOutlineHeadings([{ depth: 3, text: "Lonely", id: "lonely", line: 1 }])).toEqual([
		{ depth: 3, text: "Lonely", id: "lonely", line: 1, children: [] },
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

test("GFM footnotes in headings share one id with the renderer", () => {
	const markdown = `# Details [^note]

[^note]: a footnote

# Details
`;
	expect(ids(markdown)).toEqual(["details", "details-1"]);
	const html = renderHeadings(markdown);
	expect(html).toContain('id="user-content-details"');
	expect(html).toContain('id="user-content-details-1"');
	expect(html).not.toContain("user-content-details-note");
});

test("unicode headings get nonempty ids shared with the renderer", () => {
	const markdown = `# 中文

## 日本語

# 中文
`;
	expect(ids(markdown)).toEqual(["中文", "日本語", "中文-1"]);
	const html = renderHeadings(markdown);
	for (const id of ids(markdown)) {
		expect(html).toContain(`id="user-content-${id}"`);
	}
});

test("punctuation-only headings still get a stable fallback id", () => {
	expect(ids("# !!!\n\n## ???\n")).toEqual(["heading", "heading-1"]);
});

test("spliced segments reuse document-wide heading ids", () => {
	const markdown = `## Repeat

between

## Repeat
`;
	const outline = extractMarkdownOutline(markdown);
	const entries = flattenOutlineHeadings(outline);
	expect(entries.map((entry) => [entry.heading.id, entry.heading.line])).toEqual([
		["repeat", 1],
		["repeat-1", 5],
	]);
	const first = "## Repeat\n\nbetween";
	const second = "\n## Repeat\n";
	const firstIds = headingIdsInSlice(outline, 0, first);
	const secondIds = headingIdsInSlice(outline, 3, second);
	expect([...firstIds.byLine]).toEqual([[1, "repeat"]]);
	expect([...secondIds.byLine]).toEqual([[2, "repeat-1"]]);
	const html = `${renderHeadings(first, firstIds)}${renderHeadings(second, secondIds)}`;
	expect(html).toContain('id="user-content-repeat"');
	expect(html).toContain('id="user-content-repeat-1"');
	expect(html.match(/id="user-content-repeat"/g)?.length).toBe(1);
});

test("a heading that only parses inside a segment cannot take a later heading's id", () => {
	const markdown = "# Top\n\nFirst\nSecond\n----\n\n## Last\n";
	const outline = extractMarkdownOutline(markdown);
	expect(
		flattenOutlineHeadings(outline).map((entry) => [entry.heading.id, entry.heading.line]),
	).toEqual([
		["top", 1],
		["first-second", 3],
		["last", 7],
	]);
	const head = "# Top\n\nFirst";
	const tail = "Second\n----\n\n## Last\n";
	const html = `${renderHeadings(head, headingIdsInSlice(outline, 0, head))}${renderHeadings(
		tail,
		headingIdsInSlice(outline, 3, tail),
	)}`;
	expect(html.match(/id="user-content-last"/g)?.length).toBe(1);
	expect(html).toMatch(/<h2 id="user-content-last">Last<\/h2>/);
	expect(html).toContain('id="user-content-second"');
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
