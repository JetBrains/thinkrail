import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Markdown } from "@/chat/Markdown";
import { notebookMarkdownComponents, notebookMarkdownUrlTransform } from "./NotebookOutputView";

const components = notebookMarkdownComponents(
	{ workspaceId: "ws", path: "nb/demo.ipynb" },
	(workspaceId, path) => `http://host.test/files/${workspaceId}/${path}`,
);

function renderNotebookMarkdown(text: string): string {
	return renderToStaticMarkup(
		createElement(Markdown, {
			text,
			components,
			urlTransform: notebookMarkdownUrlTransform,
		}),
	);
}

test("notebook markdown loads relative images from the host byte route, resolved against the notebook", () => {
	const markup = renderNotebookMarkdown("![plot](../img/plot.png?v=2)");
	expect(markup).toContain('src="http://host.test/files/ws/img/plot.png"');
	expect(markup).not.toContain("notebook-disabled-image");
	const escaped = renderNotebookMarkdown("![plot](../../../etc/passwd)");
	expect(escaped).toContain('data-testid="notebook-disabled-image"');
	expect(escaped).not.toContain("<img");
});

test("notebook markdown replaces remote images with a URL-labelled placeholder", () => {
	const markup = renderNotebookMarkdown("![plot](https://attacker.invalid/pixel.png)");
	expect(markup).toContain('data-testid="notebook-disabled-image"');
	expect(markup).toContain("https://attacker.invalid/pixel.png");
	expect(markup).not.toContain("<img");
});

test("notebook markdown retains raster data images", () => {
	for (const mime of ["png", "jpeg", "gif", "webp", "avif"]) {
		const markup = renderNotebookMarkdown(`![plot](data:image/${mime};base64,cG5n)`);
		expect(markup).toContain("<img");
		expect(markup).toContain(`src="data:image/${mime};base64,cG5n"`);
		expect(markup).not.toContain("notebook-disabled-image");
	}
});

test("notebook markdown renders SVG data images in an inert frame", () => {
	const svg = '<svg xmlns="http://www.w3.org/2000/svg"><script>attack()</script></svg>';
	const markup = renderNotebookMarkdown(`![diagram](data:image/svg+xml;base64,${btoa(svg)})`);
	expect(markup).toContain("<iframe");
	expect(markup).toContain('sandbox=""');
	expect(markup).toContain("data:image/svg+xml;charset=utf-8,%3Csvg");
	expect(markup).not.toContain('<img src="data:image/svg+xml');
});

test("notebook markdown rejects non-raster, non-SVG data images", () => {
	const markup = renderNotebookMarkdown("![bitmap](data:image/bmp;base64,Qk0=)");
	expect(markup).toContain('data-testid="notebook-disabled-image"');
	expect(markup).not.toContain("<img");
	expect(markup).not.toContain("<iframe");
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
