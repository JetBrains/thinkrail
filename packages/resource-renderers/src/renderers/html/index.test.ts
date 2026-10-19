import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { htmlRenderer } from ".";
import { HtmlFrame } from "./HtmlFrame";
import { HTML_PREVIEW_CSP, prepareHtmlPreviewDocument } from "./htmlDocument";

interface FakeAttribute {
	name: string;
	value: string;
}

class FakeElement {
	readonly children: FakeElement[] = [];
	private readonly values = new Map<string, string>();
	private parent: FakeElement | null = null;

	constructor(
		readonly localName: string,
		attributes: Record<string, string> = {},
		private readonly text = "",
		children: readonly FakeElement[] = [],
	) {
		for (const [name, value] of Object.entries(attributes)) this.values.set(name, value);
		for (const child of children) this.append(child);
	}

	get attributes(): FakeAttribute[] {
		return [...this.values].map(([name, value]) => ({ name, value }));
	}

	get outerHTML(): string {
		const attributes = [...this.values]
			.map(([name, value]) => ` ${name}="${escapeMarkup(value)}"`)
			.join("");
		const body = `${escapeMarkup(this.text)}${this.children.map((child) => child.outerHTML).join("")}`;
		return `<${this.localName}${attributes}>${body}</${this.localName}>`;
	}

	append(child: FakeElement): void {
		child.remove();
		child.parent = this;
		this.children.push(child);
	}

	prepend(...children: FakeElement[]): void {
		for (const child of children) child.remove();
		for (const child of [...children].reverse()) {
			child.parent = this;
			this.children.unshift(child);
		}
	}

	getAttribute(name: string): string | null {
		return this.values.get(name) ?? null;
	}

	setAttribute(name: string, value: string): void {
		this.values.set(name, value);
	}

	removeAttribute(name: string): void {
		this.values.delete(name);
	}

	remove(): void {
		if (!this.parent) return;
		const index = this.parent.children.indexOf(this);
		if (index >= 0) this.parent.children.splice(index, 1);
		this.parent = null;
	}
}

class FakeDocument {
	readonly head: FakeElement;
	readonly documentElement: FakeElement;

	constructor(head: FakeElement, body: FakeElement) {
		this.head = head;
		this.documentElement = new FakeElement("html", {}, "", [head, body]);
	}

	createElement(name: string): FakeElement {
		return new FakeElement(name);
	}
}

function escapeMarkup(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll('"', "&quot;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;");
}

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
	expect(htmlRenderer).toMatchObject({
		id: "thinkrail/html",
		label: "Preview",
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
	const openingTag = markup.slice(0, markup.indexOf(">") + 1);
	expect([...openingTag.matchAll(/\ssandbox="([^"]*)"/g)].map((match) => match[1])).toEqual([""]);
	expect(openingTag).not.toContain("allow-");
});
