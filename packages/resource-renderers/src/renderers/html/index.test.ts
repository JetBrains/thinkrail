import { expect, test } from "bun:test";
import { currentTranslator } from "@thinkrail/locales/react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ResourceEnvironmentProvider } from "../../host";
import { describeResource, registerResourceRenderer, resolveRenderers } from "../../registry";
import { codeRenderer } from "../code";
import { sideCaption } from "../VisualDiff";
import { htmlRenderer, interactiveHtmlRenderer } from ".";
import { HtmlFrame } from "./HtmlFrame";
import {
	HTML_INTERACTIVE_CSP,
	HTML_PREVIEW_CSP,
	prepareHtmlPreviewDocument,
	prepareInteractiveHtmlDocument,
	SCROLL_BRIDGE_SOURCE,
} from "./htmlDocument";
import { isInteractiveHtmlPath } from "./interactive";
import {
	createScrollLink,
	messageScrollEndpoint,
	type ScrollLinkClock,
	windowScrollEndpoint,
} from "./scrollLink";
import { HtmlPreviewNotice } from "./ViewportSwitch";

interface FakeAttribute {
	name: string;
	value: string;
}

class FakeElement {
	readonly children: FakeElement[] = [];
	private readonly values = new Map<string, string>();
	private parent: FakeElement | null = null;
	readonly localName: string;
	private text: string;

	constructor(
		localName: string,
		attributes: Record<string, string> = {},
		text = "",
		children: readonly FakeElement[] = [],
	) {
		this.localName = localName;
		this.text = text;
		for (const [name, value] of Object.entries(attributes)) this.values.set(name, value);
		for (const child of children) this.append(child);
	}

	set textContent(value: string) {
		this.text = value;
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

function frameSandbox(props: Parameters<typeof HtmlFrame>[0]): string[] {
	const markup = renderToStaticMarkup(createElement(HtmlFrame, props));
	const iframeAt = markup.indexOf("<iframe");
	const openingTag = markup.slice(iframeAt, markup.indexOf(">", iframeAt) + 1);
	expect(markup.match(/<iframe/g)).toHaveLength(1);
	return [...openingTag.matchAll(/\ssandbox="([^"]*)"/g)].map((match) => match[1] ?? "");
}

const PREVIEW = "<!doctype html><html><body>preview</body></html>";

test("HTML frames carry exactly an empty sandbox capability set", () => {
	expect(frameSandbox({ title: "HTML preview", document: PREVIEW })).toEqual([""]);
});

test("paired HTML frames add only same-origin access, never scripts", () => {
	expect(
		frameSandbox({ title: "HTML preview", document: PREVIEW, scrollLink: createScrollLink() }),
	).toEqual(["allow-same-origin"]);
});

interface FakeScroller {
	scrollTop: number;
	scrollLeft: number;
	scrollTo(options: ScrollToOptions): void;
}

class FakeView {
	readonly scroller = { scrollTop: 0, scrollLeft: 0, maxTop: Number.POSITIVE_INFINITY };
	readonly behaviors: Array<ScrollBehavior | undefined> = [];
	readonly document: { scrollingElement: FakeScroller };
	private listener: (() => void) | null = null;

	constructor(maxTop = Number.POSITIVE_INFINITY) {
		const scroller = this.scroller;
		const behaviors = this.behaviors;
		scroller.maxTop = maxTop;
		this.document = {
			scrollingElement: {
				get scrollTop() {
					return scroller.scrollTop;
				},
				set scrollTop(value: number) {
					scroller.scrollTop = Math.min(value, scroller.maxTop);
				},
				get scrollLeft() {
					return scroller.scrollLeft;
				},
				set scrollLeft(value: number) {
					scroller.scrollLeft = value;
				},
				scrollTo({ top = scroller.scrollTop, left = scroller.scrollLeft, behavior }) {
					behaviors.push(behavior);
					scroller.scrollTop = Math.min(top, scroller.maxTop);
					scroller.scrollLeft = left;
				},
			},
		};
	}
	addEventListener(_type: string, listener: () => void) {
		this.listener = listener;
	}
	removeEventListener() {
		this.listener = null;
	}
	silentScroll(top: number) {
		this.document.scrollingElement.scrollTop = top;
	}
	userScroll(top: number) {
		this.silentScroll(top);
		this.listener?.();
	}
	echo() {
		this.listener?.();
	}
	get attached() {
		return this.listener !== null;
	}
}

class FakeClock implements ScrollLinkClock {
	private readonly frames = new Map<number, () => void>();
	private readonly polls = new Set<() => void>();
	private next = 1;
	requestFrame(callback: () => void) {
		const handle = this.next++;
		this.frames.set(handle, callback);
		return handle;
	}
	cancelFrame(handle: number) {
		this.frames.delete(handle);
	}
	every(_ms: number, callback: () => void) {
		this.polls.add(callback);
		return () => this.polls.delete(callback);
	}
	poll() {
		for (const callback of this.polls) callback();
	}
	frame() {
		const pending = [...this.frames.values()];
		this.frames.clear();
		for (const callback of pending) callback();
	}
	get pendingFrames() {
		return this.frames.size;
	}
	get polling() {
		return this.polls.size > 0;
	}
}

function asWindow(view: FakeView): Window {
	return view as unknown as Window;
}

test("a scroll link mirrors the scrolled document onto its pair and ignores the echo", () => {
	const link = createScrollLink(new FakeClock());
	const left = new FakeView();
	const right = new FakeView(300);
	link.attach(windowScrollEndpoint(asWindow(left)));
	link.attach(windowScrollEndpoint(asWindow(right)));

	left.userScroll(500);
	expect(right.scroller.scrollTop).toBe(300);
	right.echo();
	expect(left.scroller.scrollTop).toBe(500);

	right.userScroll(120);
	expect(left.scroller.scrollTop).toBe(120);
	expect(new Set([...left.behaviors, ...right.behaviors])).toEqual(new Set(["instant"]));
});

test("without scroll events, as in WebKit's script-less sandbox, polling finds the move and follows it until it settles", () => {
	const clock = new FakeClock();
	const link = createScrollLink(clock);
	const left = new FakeView();
	const right = new FakeView();
	link.attach(windowScrollEndpoint(asWindow(left)));
	link.attach(windowScrollEndpoint(asWindow(right)));
	expect(clock.polling).toBe(true);

	right.silentScroll(200);
	clock.poll();
	expect(left.scroller.scrollTop).toBe(200);
	expect(clock.pendingFrames).toBe(1);

	right.silentScroll(260);
	clock.frame();
	expect(left.scroller.scrollTop).toBe(260);
	for (let i = 0; i < 30; i++) clock.frame();
	expect(clock.pendingFrames).toBe(0);

	left.silentScroll(40);
	clock.poll();
	expect(right.scroller.scrollTop).toBe(40);
});

test("a scroll link places a reloaded frame at the last offset and stops polling once empty", () => {
	const clock = new FakeClock();
	const link = createScrollLink(clock);
	const left = new FakeView();
	const detach = link.attach(windowScrollEndpoint(asWindow(left)));
	left.userScroll(240);
	detach();
	expect(left.attached).toBe(false);
	expect(clock.polling).toBe(false);
	expect(clock.pendingFrames).toBe(0);

	const reloaded = new FakeView();
	link.attach(windowScrollEndpoint(asWindow(reloaded)));
	expect(reloaded.scroller.scrollTop).toBe(240);
	left.userScroll(10);
	expect(reloaded.scroller.scrollTop).toBe(240);
});

test("a caller-fixed HTML width hides the notice and its presets", () => {
	const notice = (environment: { mobile: boolean; htmlViewport?: "tablet" }) =>
		renderToStaticMarkup(
			createElement(
				ResourceEnvironmentProvider,
				{ value: environment },
				createElement(HtmlPreviewNotice, { viewport: "desktop", onViewport: () => {} }),
			),
		);
	expect(notice({ mobile: false })).toContain('data-testid="html-viewport"');
	expect(notice({ mobile: false, htmlViewport: "tablet" })).toBe("");
});

test("labelled sides name both visual captions", () => {
	const t = currentTranslator();
	const labels = { original: "Sidebar", modified: "Top tabs" };
	expect(sideCaption(t, "old", "1280 × 800", labels)).toBe("Sidebar: 1280 × 800");
	expect(sideCaption(t, "new", "1280 × 800", undefined)).toBe("New: 1280 × 800");
});

test("a compact HTML frame takes its box's height instead of the full-size floor", () => {
	const box = (compact: boolean) =>
		renderToStaticMarkup(
			createElement(HtmlFrame, { title: "HTML preview", document: PREVIEW, compact }),
		);
	expect(box(false)).toContain("min-h-[360px]");
	expect(box(true)).not.toContain("min-h-[360px]");
	expect(box(true)).toContain("min-h-0");
});

function interactiveDocument(): FakeDocument {
	const head = new FakeElement("head", {}, "", [
		new FakeElement("meta", { "http-equiv": "refresh", content: "0;url=https://attacker.invalid" }),
		new FakeElement("base", { href: "https://attacker.invalid/" }),
		new FakeElement("style", {}, "button { color: red }"),
	]);
	const body = new FakeElement("body", {}, "", [
		new FakeElement("a", { href: "https://attacker.invalid/path" }, "external"),
		new FakeElement("a", { href: "#settings" }, "in page"),
		new FakeElement("button", { onclick: "toggle()" }, "Toggle"),
		new FakeElement("input", { type: "checkbox" }),
		new FakeElement("script", {}, "function toggle() {}"),
	]);
	return new FakeDocument(head, body);
}

test("an interactive mockup keeps its scripts and controls under a no-network policy", () => {
	const document = prepareInteractiveHtmlDocument(interactiveDocument() as unknown as Document);
	expect(document.match(/Content-Security-Policy/g)).toHaveLength(1);
	expect(document).toContain(`content="${HTML_INTERACTIVE_CSP}"`);
	expect(document.indexOf("Content-Security-Policy")).toBeLessThan(document.indexOf("<script>"));
	expect(document).toContain(SCROLL_BRIDGE_SOURCE);
	expect(document).toContain('<button onclick="toggle()">Toggle</button>');
	expect(document).toContain('<input type="checkbox">');
	expect(document).toContain("<script>function toggle() {}</script>");
	expect(document).toContain('<a href="#settings">in page</a>');
	expect(document).toContain(
		'<a data-href="https://attacker.invalid/path" title="https://attacker.invalid/path">external</a>',
	);
	for (const fragment of ['http-equiv="refresh"', "<base"])
		expect(document).not.toContain(fragment);
});

test("the interactive policy allows inline script and no network at all", () => {
	expect(HTML_INTERACTIVE_CSP).toBe(
		"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; base-uri 'none'; form-action 'none'; object-src 'none'; frame-src 'none'; child-src 'none'; worker-src 'none'",
	);
});

test("an interactive frame runs scripts only without same-origin, paired or not, and carries the policy", () => {
	for (const scrollLink of [undefined, createScrollLink(new FakeClock())]) {
		const markup = renderToStaticMarkup(
			createElement(HtmlFrame, {
				title: "Mockup",
				document: PREVIEW,
				interactive: true,
				...(scrollLink ? { scrollLink } : {}),
			}),
		);
		const openingTag = markup.slice(
			markup.indexOf("<iframe"),
			markup.indexOf(">", markup.indexOf("<iframe")) + 1,
		);
		expect([...openingTag.matchAll(/\ssandbox="([^"]*)"/g)].map((match) => match[1])).toEqual([
			"allow-scripts",
		]);
		expect(openingTag).toContain(`csp="${HTML_INTERACTIVE_CSP.replaceAll("'", "&#x27;")}"`);
	}
});

test("only mockup paths get the Interactive candidate, ranked above the static preview", () => {
	const unregister = [
		registerResourceRenderer(codeRenderer),
		registerResourceRenderer(htmlRenderer),
		registerResourceRenderer(interactiveHtmlRenderer([".thinkrail/context/mockups/*.html"])),
	];
	try {
		const ids = (path: string) =>
			resolveRenderers(
				describeResource("w", path, { text: true, hash: "h", byteLength: 1 }),
				"view",
				{ mobile: false },
			).map((renderer) => renderer.id);
		expect(ids(".thinkrail/context/mockups/nav/a.html")).toEqual([
			"thinkrail/html-interactive",
			"thinkrail/html",
			"thinkrail/code",
		]);
		expect(ids("src/index.html")).toEqual(["thinkrail/html", "thinkrail/code"]);
		expect(ids(".thinkrail/context/report.html")).toEqual(["thinkrail/html", "thinkrail/code"]);
		expect(isInteractiveHtmlPath(".thinkrail/context/mockups/a.html")).toBe(true);
		expect(isInteractiveHtmlPath("docs/mockups/a.html")).toBe(false);
		expect(currentTranslator()(interactiveHtmlRenderer([]).labelKey)).toBe("Interactive");
	} finally {
		for (const undo of unregister.reverse()) undo();
	}
});

class FakeFrame {
	readonly posted: unknown[] = [];
	maxTop = Number.POSITIVE_INFINITY;
	postMessage(message: unknown) {
		this.posted.push(message);
	}
}

class FakeHost {
	private readonly listeners = new Set<(event: MessageEvent) => void>();
	addEventListener(_type: string, listener: (event: MessageEvent) => void) {
		this.listeners.add(listener);
	}
	removeEventListener(_type: string, listener: (event: MessageEvent) => void) {
		this.listeners.delete(listener);
	}
	deliver(source: unknown, data: unknown) {
		for (const listener of this.listeners) listener({ source, data } as MessageEvent);
	}
	get listening() {
		return this.listeners.size;
	}
}

function bridged(frame: FakeFrame, host: FakeHost, kind: "scroll" | "applied", top: number) {
	host.deliver(frame, { source: SCROLL_BRIDGE_SOURCE, kind, top, left: 0 });
}

test("a scripted frame syncs through its bridge, and its clamped answer is not taken for a scroll", () => {
	const link = createScrollLink(new FakeClock());
	const left = new FakeView();
	const frame = new FakeFrame();
	const host = new FakeHost();
	link.attach(windowScrollEndpoint(asWindow(left)));
	const detach = link.attach(
		messageScrollEndpoint(frame as unknown as Window, host as unknown as Window),
	);
	expect(frame.posted.at(-1)).toEqual({
		source: SCROLL_BRIDGE_SOURCE,
		kind: "scrollTo",
		top: 0,
		left: 0,
	});

	left.userScroll(500);
	expect(frame.posted.at(-1)).toMatchObject({ kind: "scrollTo", top: 500 });
	bridged(frame, host, "applied", 300);
	bridged(frame, host, "scroll", 300);
	expect(left.scroller.scrollTop).toBe(500);

	bridged(frame, host, "scroll", 120);
	expect(left.scroller.scrollTop).toBe(120);

	host.deliver({}, { source: SCROLL_BRIDGE_SOURCE, kind: "scroll", top: 900, left: 0 });
	host.deliver(frame, { source: SCROLL_BRIDGE_SOURCE, kind: "scroll", top: "900", left: 0 });
	host.deliver(frame, { source: "other", kind: "scroll", top: 900, left: 0 });
	expect(left.scroller.scrollTop).toBe(120);

	detach();
	expect(host.listening).toBe(0);
});
