import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FakeDocument, FakeElement } from "../../testing/fakeDocument";
import {
	frameBootstrap,
	frameMessage,
	frameNonce,
	THEME_CHANGE_EVENT,
	themeMessage,
} from "./frameMessages";
import { rootCustomPropertyNames, themeCss } from "./hostTheme";
import { prepareScriptedHtmlDocument, SCRIPTED_HTML_CSP } from "./htmlDocument";
import { ScriptedHtmlFrame } from "./ScriptedHtmlFrame";
import { clampContentHeight, HTML_CONTENT_HEIGHT, htmlFitGeometry } from "./viewport";

function mockupDocument(): FakeDocument {
	const head = new FakeElement("head", {}, "", [
		new FakeElement("meta", { "http-equiv": "refresh", content: "0;url=https://attacker.invalid" }),
		new FakeElement("base", { href: "https://attacker.invalid/" }),
		new FakeElement("link", { rel: "stylesheet", href: "thinkrail-theme.css" }),
		new FakeElement("link", { rel: "stylesheet", href: "https://cdn.example/chart.css" }),
		new FakeElement("link", { rel: "preload", href: "https://cdn.example/font.woff2" }),
		new FakeElement("script", { src: "https://cdn.example/d3.js" }),
		new FakeElement("script", { src: "local.js" }),
	]);
	const body = new FakeElement("body", {}, "", [
		new FakeElement("button", { onclick: "toggle()" }, "Toggle"),
		new FakeElement("input", { type: "checkbox", formaction: "https://attacker.invalid" }),
		new FakeElement("form", { action: "https://attacker.invalid" }, "form"),
		new FakeElement("a", { href: "#details" }, "jump"),
		new FakeElement("a", { href: "https://attacker.invalid/path", ping: "https://p.invalid" }, "x"),
		new FakeElement("a", { href: "javascript:attack()" }, "js"),
		new FakeElement("img", { src: "https://cdn.example/logo.png" }),
		new FakeElement("img", { src: "http://plain.invalid/pixel.png" }),
		new FakeElement("img", { src: "javascript:attack()" }),
		new FakeElement("object", { data: "https://attacker.invalid/object" }),
		new FakeElement("embed", { src: "https://attacker.invalid/embed" }),
		new FakeElement("iframe", { srcdoc: "<p>nested</p>" }),
		new FakeElement("svg", {}, "", [new FakeElement("use", { "xlink:href": "#glyph" })]),
		new FakeElement("script", {}, "render()"),
	]);
	return new FakeDocument(head, body);
}

test("a scripted mockup keeps scripts, controls and https resources but not embedding or navigation", () => {
	const html = prepareScriptedHtmlDocument(
		mockupDocument() as unknown as Document,
		":root{--text-default:#123456}",
		"nonce-1",
	);
	expect(html).toContain(`content="${SCRIPTED_HTML_CSP}"`);
	expect(html.match(/Content-Security-Policy/g)).toHaveLength(1);
	for (const kept of [
		'<link rel="stylesheet" href="https://cdn.example/chart.css">',
		'<script src="https://cdn.example/d3.js">',
		'<button onclick="toggle()">Toggle</button>',
		'<input type="checkbox">',
		'<form action="https://attacker.invalid">',
		'<a href="#details">jump</a>',
		'<img src="https://cdn.example/logo.png">',
		'<use xlink:href="#glyph">',
		"<script>render()</script>",
	]) {
		expect(html).toContain(kept);
	}
	expect(html).toContain(
		'<a data-href="https://attacker.invalid/path" title="https://attacker.invalid/path">x</a>',
	);
	for (const removed of [
		'http-equiv="refresh"',
		"<base",
		"thinkrail-theme.css",
		'rel="preload"',
		'src="local.js"',
		'<a href="https://attacker.invalid/path"',
		'<a href="javascript:',
		'src="javascript:',
		"http://plain.invalid",
		"<object",
		"<embed",
		"<iframe",
		"srcdoc=",
		"ping=",
		"formaction=",
	]) {
		expect(html).not.toContain(removed);
	}
});

test("the live theme and the frame bootstrap come before any author content", () => {
	const html = prepareScriptedHtmlDocument(
		mockupDocument() as unknown as Document,
		":root{--text-default:#123456}",
		"nonce-1",
	);
	const theme = html.indexOf("data-thinkrail-theme");
	const bootstrap = html.indexOf("thinkrail:height");
	expect(html.indexOf("Content-Security-Policy")).toBeLessThan(theme);
	expect(html).toContain("--text-default:#123456");
	expect(theme).toBeLessThan(bootstrap);
	expect(bootstrap).toBeLessThan(html.indexOf("https://cdn.example/chart.css"));
	expect(bootstrap).toBeLessThan(html.indexOf("https://cdn.example/d3.js"));
});

test("the scripted CSP allows inline and https scripts and styles but no network requests", () => {
	expect(SCRIPTED_HTML_CSP).toBe(
		"default-src 'none'; script-src 'unsafe-inline' https:; style-src 'unsafe-inline' https:; img-src data: blob: https:; font-src data: https:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-src 'none'; object-src 'none'",
	);
});

test("a scripted frame may run scripts and nothing else", () => {
	const parser = Reflect.get(globalThis, "DOMParser");
	Reflect.set(
		globalThis,
		"DOMParser",
		class {
			parseFromString() {
				return new FakeDocument(new FakeElement("head"), new FakeElement("body"));
			}
		},
	);
	let markup = "";
	try {
		markup = renderToStaticMarkup(
			createElement(ScriptedHtmlFrame, {
				title: "Mockup",
				source: "<p>chart</p>",
				viewport: "responsive",
			}),
		);
	} finally {
		Reflect.set(globalThis, "DOMParser", parser);
	}
	const opening = markup.slice(
		markup.indexOf("<iframe"),
		markup.indexOf(">", markup.indexOf("<iframe")),
	);
	expect([...opening.matchAll(/\ssandbox="([^"]*)"/g)].map((match) => match[1])).toEqual([
		"allow-scripts",
	]);
	expect(opening).not.toContain("allow-same-origin");
});

test("content height is clamped to the documented bounds", () => {
	expect(clampContentHeight(40)).toBe(HTML_CONTENT_HEIGHT.min);
	expect(clampContentHeight(640.2)).toBe(641);
	expect(clampContentHeight(90_000)).toBe(HTML_CONTENT_HEIGHT.max);
	expect(clampContentHeight(Number.NaN)).toBe(HTML_CONTENT_HEIGHT.min);
	expect(HTML_CONTENT_HEIGHT).toEqual({ min: 120, max: 1600 });
});

test("a fitted frame keeps the design width and clamps the rendered box height", () => {
	expect(htmlFitGeometry("desktop", 640, 900)).toEqual({ width: 1280, height: 900, scale: 0.5 });
	expect(htmlFitGeometry("desktop", 640, 100)).toEqual({ width: 1280, height: 240, scale: 0.5 });
	expect(htmlFitGeometry("desktop", 640, 5000)).toEqual({ width: 1280, height: 3200, scale: 0.5 });
	expect(htmlFitGeometry("desktop", 640, 3200)).toEqual({ width: 1280, height: 3200, scale: 0.5 });
	expect(htmlFitGeometry("responsive", 640, 300)).toEqual({ width: 640, height: 300, scale: 1 });
	expect(htmlFitGeometry("phone", 800, null)).toEqual({
		width: 390,
		height: HTML_CONTENT_HEIGHT.min,
		scale: 1,
	});
});

test("the bootstrap swaps the theme style and then announces the change", () => {
	const bootstrap = frameBootstrap("nonce-1");
	const swap = bootstrap.indexOf("theme.textContent = data.css");
	const announce = bootstrap.indexOf(`dispatchEvent(new Event("${THEME_CHANGE_EVENT}"))`);
	expect(THEME_CHANGE_EVENT).toBe("thinkrail:themechange");
	expect(swap).toBeGreaterThan(-1);
	expect(announce).toBeGreaterThan(swap);
});

test("only well-formed messages carrying the build's nonce are accepted", () => {
	expect(frameMessage({ type: "thinkrail:height", height: 320, nonce: "n1" }, "n1")).toEqual({
		kind: "height",
		height: 320,
	});
	expect(frameMessage({ type: "thinkrail:ready", nonce: "n1" }, "n1")).toEqual({ kind: "ready" });
	expect(frameMessage({ type: "thinkrail:leave", nonce: "n1" }, "n1")).toEqual({ kind: "leave" });
	for (const data of [
		null,
		"thinkrail:height",
		{ type: "thinkrail:height", height: 320 },
		{ type: "thinkrail:ready" },
		{ type: "thinkrail:ready", nonce: "n2" },
		{ type: "thinkrail:height", height: "320", nonce: "n1" },
		{ type: "thinkrail:height", height: Number.POSITIVE_INFINITY, nonce: "n1" },
		{ type: "thinkrail:height", height: -1, nonce: "n1" },
		{ type: "other", height: 320, nonce: "n1" },
	]) {
		expect(frameMessage(data, "n1")).toBeNull();
	}
	expect(themeMessage("a{}")).toEqual({ type: "thinkrail:theme", css: "a{}" });
});

test("each build gets a fresh nonce that the bootstrap hides from author scripts", () => {
	const nonce = frameNonce();
	expect(nonce).toMatch(/^[0-9a-f]{32}$/);
	expect(frameNonce()).not.toBe(nonce);
	const bootstrap = frameBootstrap(nonce);
	expect(bootstrap).toContain(JSON.stringify(nonce));
	expect(bootstrap.indexOf("script.remove()")).toBeLessThan(bootstrap.indexOf(nonce));
	for (const type of ["thinkrail:ready", "thinkrail:leave", "thinkrail:height"]) {
		expect(bootstrap).toContain(type);
	}
	expect(bootstrap).toMatch(/addEventListener\("pagehide"/);
});

function declaration(entries: Record<string, string>): CSSStyleDeclaration {
	const names = Object.keys(entries);
	return {
		length: names.length,
		item: (index: number) => names[index] ?? "",
	} as CSSStyleDeclaration;
}

test("token names come from :root rules, nested groups and the root's inline palette", () => {
	const sheet = {
		cssRules: [
			{ selectorText: ":root", style: declaration({ "--text-default": "", color: "" }) },
			{
				cssRules: [
					{
						selectorText: ':root[data-theme-appearance="dark"]',
						style: declaration({ "--overlay": "" }),
					},
					{ selectorText: ".card", style: declaration({ "--card-only": "" }) },
				],
			},
		],
	} as unknown as CSSStyleSheet;
	const blocked = {
		get cssRules(): CSSRuleList {
			throw new Error("cross-origin");
		},
	} as unknown as CSSStyleSheet;
	const root = { style: declaration({ "--background": "", "color-scheme": "" }) } as HTMLElement;
	expect(rootCustomPropertyNames(root, [sheet, blocked])).toEqual([
		"--background",
		"--overlay",
		"--text-default",
	]);
});

test("theme CSS resolves each token in a plain :root rule the author can override", () => {
	const css = themeCss({
		names: ["--background", "--missing"],
		value: (name) => (name === "--background" ? " #09090b " : ""),
		colorScheme: "dark",
	});
	expect(css.startsWith(":root{color-scheme:dark;--background:#09090b;}")).toBe(true);
	expect(css).not.toContain("--missing");
	expect(css).toContain(":where(html){background:var(--container-workspace-bg)");
});
