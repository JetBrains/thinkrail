import { expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import {
	externalNavigationUrl,
	installExternalLinkRouting,
	installExternalNavigation,
	windowNavigationRules,
} from "./externalNavigation";

const origin = "http://127.0.0.1:24242";

type LinkWindow = Parameters<typeof installExternalLinkRouting>[0];
type FakeClick = {
	button: number;
	ctrlKey: boolean;
	metaKey: boolean;
	defaultPrevented: boolean;
	target: unknown;
	preventDefault(): void;
};

function linkTarget(href: string, attributes: string[] = []): unknown {
	const anchor = { href, hasAttribute: (name: string) => attributes.includes(name) };
	return { nodeType: 1, closest: (selector: string) => (selector === "a[href]" ? anchor : null) };
}

function routedWindow() {
	const listeners = new Map<string, ((event: Event) => void)[]>();
	const assigned: string[] = [];
	const nativeOpens: unknown[][] = [];
	const view = {
		location: { origin, assign: (url: string) => assigned.push(url) },
		addEventListener: (type: string, listener: (event: Event) => void) => {
			listeners.set(type, [...(listeners.get(type) ?? []), listener]);
		},
		open: (...args: unknown[]) => {
			nativeOpens.push(args);
			return null;
		},
	} as unknown as LinkWindow;
	installExternalLinkRouting(view);
	const dispatch = (type: "click" | "auxclick", target: unknown, init: Partial<FakeClick> = {}) => {
		const event: FakeClick = {
			button: type === "click" ? 0 : 1,
			ctrlKey: false,
			metaKey: false,
			defaultPrevented: false,
			target,
			preventDefault() {
				event.defaultPrevented = true;
			},
			...init,
		};
		for (const listener of listeners.get(type) ?? []) listener(event as unknown as Event);
		return event;
	};
	return { view, assigned, nativeOpens, dispatch };
}

test("keeps same-origin navigation inside the webview", () => {
	expect(externalNavigationUrl(`${origin}/#/v1`, origin)).toBeNull();
	expect(externalNavigationUrl({ url: `${origin}/files/a/b` }, origin)).toBeNull();
});

test("opens reviewed external protocols only", () => {
	expect(externalNavigationUrl("https://example.com/docs", origin)).toBe(
		"https://example.com/docs",
	);
	expect(externalNavigationUrl({ url: "mailto:hello@thinkrail.ai" }, origin)).toBe(
		"mailto:hello@thinkrail.ai",
	);
	expect(externalNavigationUrl("file:///tmp/private", origin)).toBeNull();
	expect(externalNavigationUrl("javascript:alert(1)", origin)).toBeNull();
});

test("opens the serialized will-navigate payload emitted by the native SDK", () => {
	expect(
		externalNavigationUrl(
			JSON.stringify({ url: "https://example.com/docs", allowed: false }),
			origin,
		),
	).toBe("https://example.com/docs");
	expect(
		externalNavigationUrl(JSON.stringify({ url: `${origin}/#/v1`, allowed: true }), origin),
	).toBeNull();
	expect(externalNavigationUrl(JSON.stringify({ url: "mailto:hello@thinkrail.ai" }), origin)).toBe(
		"mailto:hello@thinkrail.ai",
	);
});

test.each([
	"file:///tmp/private",
	"javascript:alert(1)",
	"data:text/html,hello",
	"views://web",
])("rejects unsafe protocols in every SDK payload form: %s", (url) => {
	for (const detail of [url, { url }, JSON.stringify({ url, allowed: false })]) {
		expect(externalNavigationUrl(detail, origin)).toBeNull();
	}
});

test.each([
	null,
	{},
	{ url: 123 },
	"{broken",
	'{"url":null}',
	'{"url":{}}',
	'["https://example.com"]',
])("rejects malformed event detail: %j", (detail) => {
	expect(externalNavigationUrl(detail, origin)).toBeNull();
});

test("bounds native JSON decoding and URL length", () => {
	const url = `https://example.com/${"x".repeat(64 * 1024)}`;
	for (const detail of [url, { url }, JSON.stringify({ url })]) {
		expect(externalNavigationUrl(detail, origin)).toBeNull();
	}
});

test("subscribes only to this webview's SDK channels and removes its listeners on disposal", () => {
	const events = new EventEmitter();
	const opened: string[] = [];
	const remove = installExternalNavigation(events, 7, origin, (url) => opened.push(url));
	const navigation = {
		data: { detail: JSON.stringify({ url: "https://example.com/nav", allowed: false }) },
	};
	const popup = { data: { detail: { url: "https://example.com/popup", isCmdClick: true } } };

	events.emit("will-navigate", navigation);
	events.emit("new-window-open", popup);
	events.emit("will-navigate-8", navigation);
	events.emit("new-window-open-8", popup);
	expect(opened).toEqual([]);

	events.emit("will-navigate-7", navigation);
	events.emit("new-window-open-7", popup);
	expect(opened).toEqual(["https://example.com/nav", "https://example.com/popup"]);

	let siblingCalls = 0;
	events.on("new-window-open-7", () => siblingCalls++);
	remove();
	events.emit("will-navigate-7", navigation);
	events.emit("new-window-open-7", popup);
	expect(opened).toHaveLength(2);
	expect(siblingCalls).toBe(1);
	expect(events.listenerCount("will-navigate-7")).toBe(0);
});

test("confines the window to its origin while keeping srcdoc previews and same-origin blobs", () => {
	expect(windowNavigationRules(origin)).toEqual([
		"^*",
		`${origin}/*`,
		"about:srcdoc",
		`blob:${origin}/*`,
	]);
});

test("routes unmodified primary and middle clicks on external links into one same-window navigation", () => {
	const { assigned, dispatch } = routedWindow();

	const primary = dispatch("click", linkTarget("https://example.com/docs"));
	const middle = dispatch("auxclick", linkTarget("mailto:hello@thinkrail.ai"));

	expect(primary.defaultPrevented).toBe(true);
	expect(middle.defaultPrevented).toBe(true);
	expect(assigned).toEqual(["https://example.com/docs", "mailto:hello@thinkrail.ai"]);
});

test("leaves same-origin, unsafe, modified, download, and already-handled link clicks to the page", () => {
	const { assigned, dispatch } = routedWindow();
	const external = linkTarget("https://example.com/docs");

	const ignored = [
		dispatch("click", linkTarget(`${origin}/#/v1`)),
		dispatch("click", linkTarget("javascript:alert(1)")),
		dispatch("click", linkTarget("https://example.com/report.pdf", ["download"])),
		dispatch("click", external, { ctrlKey: true }),
		dispatch("click", external, { metaKey: true }),
		dispatch("auxclick", external, { button: 2 }),
		dispatch("click", { nodeType: 3 }),
		dispatch("click", null),
	];
	const handled = dispatch("click", external, { defaultPrevented: true });

	expect(ignored.map((event) => event.defaultPrevented)).toEqual(ignored.map(() => false));
	expect(handled.defaultPrevented).toBe(true);
	expect(assigned).toEqual([]);
});

test("routes window.open of external URLs and delegates every other call to the native open", () => {
	const { view, assigned, nativeOpens } = routedWindow();

	expect(view.open("https://example.com/compare", "_blank", "noopener,noreferrer")).toBeNull();
	expect(view.open(new URL("https://example.com/device"))).toBeNull();
	view.open(`${origin}/files/a`, "_blank");
	view.open();

	expect(assigned).toEqual(["https://example.com/compare", "https://example.com/device"]);
	expect(nativeOpens).toEqual([
		[`${origin}/files/a`, "_blank", undefined],
		[undefined, undefined, undefined],
	]);
});
