import { describe, expect, it } from "bun:test";
import { fixRawHtml, toNoCookieUrl } from "./youTubeEmbeds";

describe("toNoCookieUrl", () => {
	it("rewrites youtube.com embeds to the nocookie domain", () => {
		expect(toNoCookieUrl("https://www.youtube.com/embed/abc123")).toBe(
			"https://www.youtube-nocookie.com/embed/abc123",
		);
		expect(toNoCookieUrl("https://youtube.com/embed/abc123")).toBe(
			"https://www.youtube-nocookie.com/embed/abc123",
		);
	});

	it("leaves nocookie and non-embed URLs alone", () => {
		expect(toNoCookieUrl("https://www.youtube-nocookie.com/embed/abc")).toBe(
			"https://www.youtube-nocookie.com/embed/abc",
		);
		expect(toNoCookieUrl("https://www.youtube.com/watch?v=abc")).toBe(
			"https://www.youtube.com/watch?v=abc",
		);
	});
});

describe("fixRawHtml", () => {
	it("repairs a bare author-written YouTube iframe", () => {
		const fixed = fixRawHtml(
			'<iframe src="https://www.youtube.com/embed/abc" width="640" allowfullscreen></iframe>',
		);
		expect(fixed).toContain("youtube-nocookie.com/embed/abc");
		expect(fixed).toContain('title="YouTube video"');
		expect(fixed).toContain('loading="lazy"');
	});

	it("keeps author-provided title and loading attributes", () => {
		const fixed = fixRawHtml(
			'<iframe title="Demo" loading="eager" src="https://youtube.com/embed/x"></iframe>',
		);
		expect(fixed).toContain('title="Demo"');
		expect(fixed).toContain('loading="eager"');
		expect(fixed).not.toContain('title="YouTube video"');
	});

	it("does not touch non-YouTube iframes", () => {
		const html = '<iframe src="https://example.com/embed/thing"></iframe>';
		expect(fixRawHtml(html)).toBe(html);
	});
});
