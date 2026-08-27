import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { QuietScrollArea, QuietScrollFrame } from "./QuietScrollArea";

test("ordinary quiet scroll areas own one native viewport and four semantic curtains", () => {
	const markup = renderToStaticMarkup(
		<QuietScrollArea surface="sidebar" axis="both">
			<p>content</p>
		</QuietScrollArea>,
	);
	expect(markup.match(/quiet-scroll-viewport/g)).toHaveLength(1);
	expect(markup.match(/quiet-scroll-curtain/g)).toHaveLength(4);
	expect(markup).toContain("--color-container-sidebar-bg");
	expect(markup).not.toContain("--color-container-terminal-bg");
});

test("third-party frames observe their child instead of adding a competing viewport", () => {
	const markup = renderToStaticMarkup(
		<QuietScrollFrame
			viewportSelector=".xterm-scrollable-element"
			surface="terminal"
			edges={{ top: true, right: false, bottom: false, left: false }}
		>
			<div className="third-party-host" />
		</QuietScrollFrame>,
	);
	expect(markup).toContain("third-party-host");
	expect(markup).not.toContain("quiet-scroll-viewport");
	expect(markup).toContain("--color-container-terminal-bg");
	expect(markup).not.toContain("--color-container-sidebar-bg");
	expect(markup).toContain('data-scroll-top="true"');
	expect(markup).not.toContain("data-scroll-bottom");
});
