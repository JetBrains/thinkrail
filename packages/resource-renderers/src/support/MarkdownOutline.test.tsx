import { expect, test } from "bun:test";
import { TooltipProvider } from "@thinkrail/ui/tooltip";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TestMarkdown, testLinks } from "../testing/markdown";
import { MarkdownOutline } from "./MarkdownOutline";
import { MarkdownDocument } from "./MarkdownPreview";
import type { StampedHeading } from "./sourceLines";

function render(node: ReactNode): string {
	return renderToStaticMarkup(<TooltipProvider>{node}</TooltipProvider>);
}

const headings: StampedHeading[] = [
	{ depth: 1, text: "Alpha", line: 1 },
	{ depth: 2, text: "Beta", line: 5 },
	{ depth: 1, text: "Gamma", line: 9 },
].map((heading) => ({ ...heading, element: {} as HTMLElement, hidden: false }));

function outline(open: boolean, side: "left" | "right" = "right"): string {
	return render(
		<MarkdownOutline
			headings={headings}
			scroller={null}
			open={open}
			side={side}
			onOpenChange={() => {}}
		/>,
	);
}

test("an open outline is a labelled navigation of nested lists of heading buttons", () => {
	const html = outline(true);
	expect(html).toContain(
		'<nav data-testid="markdown-outline" data-side="right" aria-label="Outline"',
	);
	expect(html).toMatch(
		/<li><button[^>]*data-index="0"[^>]*>.*Alpha.*<\/button><ul class="[^"]*pl-tree-indent[^"]*"><li><button[^>]*data-index="1"/,
	);
	expect(html).toContain('data-index="2"');
	expect(html).toContain('title="Gamma"');
	expect(html).toMatch(/data-testid="markdown-outline-toggle" aria-pressed="true"/);
});

test("a closed outline leaves only an unpressed toggle on its edge", () => {
	const html = outline(false, "left");
	expect(html).not.toContain('data-testid="markdown-outline"');
	expect(html).toMatch(/class="absolute[^"]*left-8"/);
	expect(html).toMatch(
		/aria-label="Outline"[^>]*data-testid="markdown-outline-toggle" aria-pressed="false"/,
	);
});

test("each outline's toggle has its own focus slot, so recovery never jumps to another preview", () => {
	const html = render(
		[true, false].map((open) => (
			<MarkdownOutline
				key={String(open)}
				headings={headings}
				scroller={null}
				open={open}
				side="right"
				onOpenChange={() => {}}
			/>
		)),
	);
	const slots = [...html.matchAll(/data-focus-slot="(markdown-outline-toggle[^"]+)"/g)].map(
		(match) => match[1],
	);
	expect(slots).toHaveLength(2);
	expect(new Set(slots).size).toBe(2);
});

test("an outline on the left draws its border on the document side", () => {
	expect(outline(true, "left")).toMatch(/data-side="left"[^>]*class="[^"]*border-r/);
});

test("rendered headings carry raw-file source lines, the anchor the outline and the line reveal share", () => {
	const html = renderToStaticMarkup(
		<MarkdownDocument
			content={"---\ntitle: x\n---\n# Details [^n]\n\n<h2>Raw</h2>\n\n# 中文\n\n[^n]: note\n"}
			workspaceId="ws"
			path="DOC.md"
			Markdown={TestMarkdown}
			links={testLinks}
			stampLines
		/>,
	);
	expect(html).toMatch(/<h1 id="user-content-details" data-md-line-start="4"/);
	expect(html).toMatch(/<h2 data-md-line-start="6"[^>]*>Raw<\/h2>/);
	expect(html).toMatch(/<h1 data-md-line-start="8"[^>]*>中文<\/h1>/);
	expect(html).toMatch(/<h2 class="sr-only" id="user-content-footnote-label">/);
});
