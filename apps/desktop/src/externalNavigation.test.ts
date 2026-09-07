import { expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { externalNavigationUrl, installExternalNavigation } from "./externalNavigation";

const origin = "http://127.0.0.1:24242";

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
