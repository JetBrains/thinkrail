import { expect, test } from "bun:test";
import { externalNavigationUrl, loopbackNavigationRules } from "./externalNavigation";

const origin = "http://127.0.0.1:24242";

test("keeps same-origin navigation inside the webview", () => {
	expect(externalNavigationUrl(`${origin}/#/v1`, origin)).toBeNull();
	expect(externalNavigationUrl({ url: `${origin}/files/a/b` }, origin)).toBeNull();
});

test("treats localhost on the same port as internal", () => {
	expect(externalNavigationUrl("http://localhost:24242/page", origin)).toBeNull();
});

test("treats [::1] on the same port as internal", () => {
	expect(externalNavigationUrl("http://[::1]:24242/page", origin)).toBeNull();
});

test("treats 127.0.0.1 on the same port as internal when origin is localhost", () => {
	const localhostOrigin = "http://localhost:24242";
	expect(externalNavigationUrl("http://127.0.0.1:24242/page", localhostOrigin)).toBeNull();
});

test("opens a real external host in the OS browser", () => {
	expect(externalNavigationUrl("https://example.com/docs", origin)).toBe(
		"https://example.com/docs",
	);
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

test("loopbackNavigationRules includes all three loopback origins", () => {
	const rules = loopbackNavigationRules(24242);
	expect(rules).toContain("http://127.0.0.1:24242/*");
	expect(rules).toContain("http://localhost:24242/*");
	expect(rules).toContain("http://[::1]:24242/*");
});

test("loopbackNavigationRules starts with deny-all", () => {
	const rules = loopbackNavigationRules(24242);
	expect(rules[0]).toBe("^*");
});

test("loopbackNavigationRules does not allow external hosts", () => {
	const rules = loopbackNavigationRules(24242);
	const allowPatterns = rules.slice(1);
	for (const pattern of allowPatterns) {
		expect(pattern).toMatch(/^http:\/\/(127\.0\.0\.1|localhost|\[::1\]):\d+\/\*$/);
	}
});
