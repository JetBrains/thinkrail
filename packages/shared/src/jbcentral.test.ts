import { expect, test } from "bun:test";
import { isJbcentralProxyUrl } from "./jbcentral";

test("matches jbcentral-managed proxy baseUrls", () => {
	expect(isJbcentralProxyUrl("http://127.0.0.1:19516/wire/s3cr3t/claude-code/anthropic")).toBe(
		true,
	);
	expect(isJbcentralProxyUrl("http://127.0.0.1:4242/wire/abc/codex/openai")).toBe(true);
	expect(isJbcentralProxyUrl("http://localhost:19516/wire/s3cr3t/claude-code/anthropic")).toBe(
		true,
	);
});

test("rejects real provider endpoints and junk", () => {
	expect(isJbcentralProxyUrl("https://api.anthropic.com")).toBe(false);
	expect(isJbcentralProxyUrl("https://api.openai.com/v1")).toBe(false);
	// Loopback but not the wire path (some other local proxy).
	expect(isJbcentralProxyUrl("http://127.0.0.1:8080/v1")).toBe(false);
	// `/wire/` on a non-loopback host is someone else's URL, not the local proxy.
	expect(isJbcentralProxyUrl("https://example.com/wire/x")).toBe(false);
	expect(isJbcentralProxyUrl(undefined)).toBe(false);
	expect(isJbcentralProxyUrl("")).toBe(false);
	expect(isJbcentralProxyUrl("not a url")).toBe(false);
});
