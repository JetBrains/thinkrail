import { expect, test } from "bun:test";
import { externalNavigationUrl } from "./externalNavigation";

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

test("rejects malformed event detail", () => {
	expect(externalNavigationUrl(null, origin)).toBeNull();
	expect(externalNavigationUrl({}, origin)).toBeNull();
});
