import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Markdown } from "@/chat/Markdown";
import { notebookMarkdownComponents, notebookMarkdownUrlTransform } from "./NotebookOutputView";

function renderNotebookMarkdown(text: string): string {
	return renderToStaticMarkup(
		createElement(Markdown, {
			text,
			components: notebookMarkdownComponents,
			urlTransform: notebookMarkdownUrlTransform,
		}),
	);
}

test("notebook markdown replaces remote images with a URL-labelled placeholder", () => {
	const markup = renderNotebookMarkdown("![plot](https://attacker.invalid/pixel.png)");
	expect(markup).toContain('data-testid="notebook-disabled-image"');
	expect(markup).toContain("https://attacker.invalid/pixel.png");
	expect(markup).not.toContain("<img");
});

test("notebook markdown retains data images", () => {
	const markup = renderNotebookMarkdown("![plot](data:image/png;base64,cG5n)");
	expect(markup).toContain("<img");
	expect(markup).toContain('src="data:image/png;base64,cG5n"');
	expect(markup).not.toContain("notebook-disabled-image");
});

test("notebook markdown renders links as non-navigable text with their URL", () => {
	const markup = renderNotebookMarkdown("[documentation](https://attacker.invalid/docs)");
	expect(markup).toContain('data-testid="notebook-disabled-link"');
	expect(markup).toContain("documentation (https://attacker.invalid/docs)");
	expect(markup).not.toContain("<a");
});

test("notebook markdown does not render raw HTML", () => {
	const markup = renderNotebookMarkdown(
		'<img src="https://attacker.invalid/raw.png"><script>attack()</script>',
	);
	expect(markup).not.toContain("<img");
	expect(markup).not.toContain("<script");
});
