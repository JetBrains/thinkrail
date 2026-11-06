import { expect, test } from "bun:test";
import { currentTranslator } from "@thinkrail/locales/react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FakeDocument, FakeElement } from "../../testing/fakeDocument";
import { htmlRenderer } from ".";
import { HtmlFrame } from "./HtmlFrame";
import { HTML_PREVIEW_CSP, prepareHtmlPreviewDocument } from "./htmlDocument";

function hostileDocument(): FakeDocument {
	const head = new FakeElement("head", {}, "", [
		new FakeElement("meta", { "http-equiv": "refresh", content: "0;url=https://attacker.invalid" }),
		new FakeElement("base", { href: "https://attacker.invalid/" }),
		new FakeElement("link", { rel: "stylesheet", href: "https://attacker.invalid/site.css" }),
	]);
	const body = new FakeElement("body", {}, "", [
		new FakeElement(
			"a",
			{
				href: "https://attacker.invalid/path",
				ping: "https://attacker.invalid/ping",
				onclick: "location='https://attacker.invalid'",
			},
			"external",
		),
		new FakeElement("script", {}, "location='https://attacker.invalid'"),
		new FakeElement("form", { action: "https://attacker.invalid" }, "form"),
		new FakeElement("object", { data: "https://attacker.invalid/object" }),
		new FakeElement("embed", { src: "https://attacker.invalid/embed" }),
		new FakeElement("iframe", { srcdoc: "<script>attack()</script>" }),
		new FakeElement("input", { formaction: "https://attacker.invalid" }),
		new FakeElement("button", { formaction: "https://attacker.invalid" }, "button"),
		new FakeElement("select"),
		new FakeElement("textarea"),
		new FakeElement("area", { href: "https://attacker.invalid" }),
		new FakeElement("img", { src: "https://attacker.invalid/pixel.png" }),
		new FakeElement("img", { src: "javascript:attack()", onerror: "attack()" }),
		new FakeElement("img", { src: "vbscript:attack()" }),
		new FakeElement("img", { src: "data:image/png;base64,cG5n" }),
		new FakeElement("div", { style: "color: red", onmouseover: "attack()" }, "styled"),
		new FakeElement("svg", {}, "", [
			new FakeElement("use", { "xlink:href": "javascript:attack()" }),
		]),
	]);
	return new FakeDocument(head, body);
}

test("HTML renderer registration has no review geometry and stays sandboxed", () => {
	expect(currentTranslator()(htmlRenderer.labelKey)).toBe("Preview");
	expect(htmlRenderer).toMatchObject({
		id: "thinkrail/html",
		labelKey: "viewer.renderer.preview",
		match: { glob: ["*.html", "*.htm"], text: true },
		rank: 120,
		capabilities: {
			anchors: { view: [], diff: [] },
			mobile: true,
			copy: false,
			layout: false,
			whitespace: false,
		},
	});
});

test("HTML preview sanitization neutralizes active elements, navigation, and hostile URLs", () => {
	const document = prepareHtmlPreviewDocument(hostileDocument() as unknown as Document);
	expect(document).toContain(`content="${HTML_PREVIEW_CSP}"`);
	expect(document.match(/Content-Security-Policy/g)).toHaveLength(1);
	expect(document).toContain(
		'<a data-href="https://attacker.invalid/path" title="https://attacker.invalid/path">external</a>',
	);
	expect(document).toContain('<img src="data:image/png;base64,cG5n"></img>');
	expect(document).toContain('<div style="color: red">styled</div>');
	for (const fragment of [
		'http-equiv="refresh"',
		"<base",
		"<link",
		"<script",
		"<form",
		"<object",
		"<embed",
		"<iframe",
		"<input",
		"<button",
		"<select",
		"<textarea",
		"<area",
		"javascript:",
		"vbscript:",
		"https://attacker.invalid/pixel.png",
		"onerror=",
		"onclick=",
		"onmouseover=",
		"ping=",
		"formaction=",
		"srcdoc=",
		"xlink:href=",
	]) {
		expect(document).not.toContain(fragment);
	}
});

test("HTML preview CSP is exact", () => {
	expect(HTML_PREVIEW_CSP).toBe(
		"default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; font-src data:; base-uri 'none'; form-action 'none'; object-src 'none'; frame-src 'none'; child-src 'none'",
	);
});

test("HTML frames carry exactly an empty sandbox capability set", () => {
	const markup = renderToStaticMarkup(
		createElement(HtmlFrame, {
			title: "HTML preview",
			document: "<!doctype html><html><body>preview</body></html>",
		}),
	);
	const iframeAt = markup.indexOf("<iframe");
	const openingTag = markup.slice(iframeAt, markup.indexOf(">", iframeAt) + 1);
	expect(markup.match(/<iframe/g)).toHaveLength(1);
	expect([...openingTag.matchAll(/\ssandbox="([^"]*)"/g)].map((match) => match[1])).toEqual([""]);
	expect(openingTag).not.toContain("allow-");
});
