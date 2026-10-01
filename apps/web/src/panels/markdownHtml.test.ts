import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Markdown } from "../chat/Markdown";
import { alertComponents, remarkGithubAlerts } from "./markdownAlerts";
import { documentRehypePlugins } from "./markdownHtml";
import { documentComponents, remarkHeadingIds } from "./markdownLinks";

const bytesUrl = (workspaceId: string, path: string) =>
	`http://host.test/files/${workspaceId}/${path}`;

function render(text: string): string {
	return renderToStaticMarkup(
		createElement(Markdown, {
			text,
			remarkPlugins: [remarkGithubAlerts, remarkHeadingIds],
			rehypePlugins: documentRehypePlugins(),
			components: {
				...alertComponents,
				...documentComponents({ workspaceId: "ws", path: "docs/README.md" }, bytesUrl),
			},
		}),
	);
}

test("raw HTML a README relies on renders: centered paragraphs, sized and floated images, details", () => {
	const html = render(
		[
			'<p align="center"><img src="../img/logo.png" width="120" alt="logo"></p>',
			'<img src="https://img.shields.io/badge/ci-green" align="right">',
			"<details><summary>More</summary>\n\nHidden *body*\n\n</details>",
		].join("\n\n"),
	);
	expect(html).toContain('<p align="center">');
	expect(html).toContain('src="http://host.test/files/ws/img/logo.png"');
	expect(html).toContain('width="120"');
	expect(html).toContain('class="float-right ml-8"');
	expect(html).toContain("<details><summary>More</summary>");
	expect(html).toContain("<em>body</em>");
});

test("picture sources rewrite every relative srcset candidate through the host byte route", () => {
	const html = render(
		'<picture><source media="(prefers-color-scheme: dark)" srcset="../img/dark.png 1x, ../img/dark@2x.png 2x"><img src="../img/light.png" alt="logo"></picture>',
	);
	expect(html).toContain(
		'srcSet="http://host.test/files/ws/img/dark.png 1x, http://host.test/files/ws/img/dark@2x.png 2x"',
	);
	expect(html).toContain('media="(prefers-color-scheme: dark)"');
	expect(html).toContain('src="http://host.test/files/ws/img/light.png"');
});

test("active content and handlers never survive: script, iframe, style, event attributes, javascript: URLs", () => {
	const html = render(
		[
			"<script>globalThis.pwned = true</script>",
			'<iframe src="https://evil.example"></iframe>',
			"<style>body{display:none}</style>",
			'<img src="x" onerror="globalThis.pwned = true">',
			'<a href="javascript:alert(1)">click</a>',
			'<div style="position:fixed">styled</div>',
		].join("\n\n"),
	);
	expect(html).not.toContain("<script");
	expect(html).not.toContain("<iframe");
	expect(html).not.toContain("<style");
	expect(html).not.toContain("onerror");
	expect(html).not.toContain("javascript:");
	expect(html).not.toContain("style=");
	expect(html).toContain("styled");
});

test("srcset candidates are parsed like a browser does and only web or worktree URLs survive", () => {
	const html = render(
		'<picture><source srcset="../img/a.png 1x,../img/b.png 2x, javascript:alert(1) 3x, data:image/png;base64,AAAA 4x, https://cdn.example/c.png 5x"><img src="javascript:alert(1)"></picture>',
	);
	expect(html).toContain(
		'srcSet="http://host.test/files/ws/img/a.png 1x, http://host.test/files/ws/img/b.png 2x, https://cdn.example/c.png 5x"',
	);
	expect(html).not.toContain("javascript:");
	expect(html).not.toContain("data:image");
	expect(html).toContain("<img");
	expect(html).not.toContain('src="javascript');
});

test("sanitizing keeps the document plugins' own output: alert callouts and clobber-safe heading ids", () => {
	const html = render("## Getting Started\n\n> [!NOTE]\n> Mind the gap.");
	expect(html).toContain('id="user-content-getting-started"');
	expect(html).toContain("Mind the gap.");
	expect(html).toMatch(/data-testid="markdown-alert"|data-variant="note"|alert/i);
});
