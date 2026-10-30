import { describe, expect, test } from "bun:test";
import { guardAccess, readAccessToken, tokensMatch } from "./accessToken";

const req = (url: string, headers?: Record<string, string>): Request =>
	new Request(url, headers ? { headers } : undefined);

describe("readAccessToken", () => {
	test("reads a bearer token from the Authorization header", () => {
		expect(readAccessToken(req("https://h/ws", { authorization: "Bearer abc123" }))).toBe("abc123");
	});

	test("is case-insensitive on the scheme and tolerates extra spacing", () => {
		expect(readAccessToken(req("https://h/ws", { authorization: "bearer   abc123" }))).toBe(
			"abc123",
		);
	});

	test("falls back to the ?token= query param", () => {
		expect(readAccessToken(req("https://h/ws?token=qtok"))).toBe("qtok");
	});

	test("prefers the header over the query param", () => {
		expect(readAccessToken(req("https://h/ws?token=qtok", { authorization: "Bearer htok" }))).toBe(
			"htok",
		);
	});

	test("returns null when absent or malformed", () => {
		expect(readAccessToken(req("https://h/ws"))).toBeNull();
		expect(readAccessToken(req("https://h/ws", { authorization: "Basic xyz" }))).toBeNull();
	});
});

describe("tokensMatch", () => {
	test("true for equal tokens", () => {
		expect(tokensMatch("s3cret-token", "s3cret-token")).toBe(true);
	});

	test("false for different tokens, including differing lengths", () => {
		expect(tokensMatch("s3cret-token", "s3cret-tokeN")).toBe(false);
		expect(tokensMatch("short", "a-much-longer-token")).toBe(false);
		expect(tokensMatch("", "x")).toBe(false);
	});
});

describe("guardAccess", () => {
	test("allows every request when no token is configured (local/same-origin)", () => {
		expect(guardAccess(req("https://h/ws"), undefined)).toBeNull();
		expect(guardAccess(req("https://h/ws?token=whatever"), undefined)).toBeNull();
	});

	test("allows a request carrying the correct token", () => {
		expect(guardAccess(req("https://h/ws?token=good"), "good")).toBeNull();
		expect(
			guardAccess(req("https://h/files/x", { authorization: "Bearer good" }), "good"),
		).toBeNull();
	});

	test("rejects a missing or wrong token with 401", () => {
		expect(guardAccess(req("https://h/ws"), "good")?.status).toBe(401);
		expect(guardAccess(req("https://h/ws?token=bad"), "good")?.status).toBe(401);
	});
});
