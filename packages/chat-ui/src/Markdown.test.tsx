import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { longMarkdown } from "../../../e2e/perf/longMarkdown";
import { CONTENT_WIDTH_BREAKOUT } from "./contentWidth";
import { BlockMarkdown, fenceLanguage, Markdown } from "./Markdown";
import { MARKDOWN_EDGE_FIXTURES } from "./markdownFixtures.test";

function withoutCarriageReturns(html: string) {
	return html.replaceAll("\r", "");
}

function expectParity(text: string) {
	const whole = renderToStaticMarkup(<Markdown text={text} />);
	const blocks = renderToStaticMarkup(<BlockMarkdown text={text} />);
	expect(withoutCarriageReturns(blocks)).toBe(withoutCarriageReturns(whole));
	return blocks;
}

function expectPrefixParity(text: string, step: number) {
	for (let end = 0; end < text.length; end += step) expectParity(text.slice(0, end));
	expectParity(text);
}

describe("BlockMarkdown", () => {
	for (const [name, fixture] of Object.entries(MARKDOWN_EDGE_FIXTURES)) {
		test(`renders like Markdown for every prefix: ${name}`, () => {
			expectPrefixParity(fixture, 1);
		});
	}

	test("renders like Markdown for prefixes of the long stream fixture", { timeout: 30_000 }, () => {
		expectPrefixParity(longMarkdown(), 97);
	});

	test("renders blocks as direct children of the prose wrapper", () => {
		const html = renderToStaticMarkup(<BlockMarkdown text={"# Title\n\nbody"} className="x" />);
		expect(html).toBe('<div class="x"><h1>Title</h1>\n<p>body</p></div>');
	});

	test("resolves reference links and footnotes across the message", () => {
		const links = expectParity(MARKDOWN_EDGE_FIXTURES.linkDefinitionAtEnd ?? "");
		expect(links).toContain('href="https://example.com"');
		const notes = expectParity(MARKDOWN_EDGE_FIXTURES.footnoteAtEnd ?? "");
		expect(notes).toContain('href="#user-content-fn-1"');
	});

	test("keeps the component and plugin overrides of Markdown", () => {
		const text = "[docs](https://example.com) and `code`";
		const components = { a: () => <span>link</span> };
		const whole = renderToStaticMarkup(<Markdown text={text} components={components} />);
		const blocks = renderToStaticMarkup(<BlockMarkdown text={text} components={components} />);
		expect(blocks).toBe(whole);
		expect(blocks).toContain("<span>link</span>");
	});

	test("lets only wide-block hosts break tables and fenced code out of the column", () => {
		const text =
			"Intro with `inline`\n\n```\nfirst\nsecond\n```\n\n| a | b |\n| - | - |\n| 1 | 2 |";
		const breakout = (html: string) =>
			[...html.matchAll(/<(\w+) class="([^"]*)"/g)]
				.filter(([, , classes]) =>
					classes?.includes(CONTENT_WIDTH_BREAKOUT.replaceAll("&", "&amp;")),
				)
				.map(([, tag]) => tag);
		expect(breakout(renderToStaticMarkup(<BlockMarkdown text={text} wideBlocks />))).toEqual([
			"pre",
			"div",
		]);
		expect(breakout(renderToStaticMarkup(<BlockMarkdown text={text} />))).toEqual([]);
		expect(breakout(renderToStaticMarkup(<Markdown text={text} />))).toEqual([]);
	});
});

describe("fenceLanguage", () => {
	for (const [className, tag] of [
		["language-c", "c"],
		["language-c++", "c++"],
		["language-c#", "c#"],
		["language-java", "java"],
		["language-ts:src/a.ts", "ts"],
		["language-js{1,3}", "js"],
	] as const) {
		test(`reads ${className} as ${tag}`, () => {
			expect(fenceLanguage(className)).toBe(tag);
		});
	}
	test("reads no fence language from a bare block", () => {
		expect(fenceLanguage(undefined)).toBeUndefined();
	});
});
