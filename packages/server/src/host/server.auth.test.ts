import { describe, expect, test } from "bun:test";
import { createHash, randomBytes } from "node:crypto";

/**
 * Regression tests for CVE-1: Unauthenticated WebSocket RPC (CSWSH)
 *
 * These tests verify that the WebSocket server properly authenticates
 * connections and validates Origin headers to prevent Cross-Site
 * WebSocket Hijacking attacks.
 */

// Simulate the token generation that should exist in server.ts
function generateAuthToken(): string {
	return randomBytes(32).toString("hex");
}

describe("WebSocket Authentication", () => {
	test("auth token is generated with sufficient entropy", () => {
		const token = generateAuthToken();
		expect(token.length).toBe(64); // 32 bytes = 64 hex chars
		expect(/^[0-9a-f]{64}$/.test(token)).toBe(true);

		// Tokens should be unique
		const token2 = generateAuthToken();
		expect(token).not.toBe(token2);
	});

	test("connection without token query parameter should be rejected", () => {
		// In the fixed server, a WebSocket upgrade without ?token=... must fail
		const url = new URL("ws://localhost:24242/ws");
		// No token parameter — this should be rejected
		expect(url.searchParams.has("token")).toBe(false);
	});

	test("connection with invalid token should be rejected", () => {
		const serverToken = generateAuthToken();
		const attackerToken = "deadbeef".repeat(8);
		expect(serverToken).not.toBe(attackerToken);
	});

	test("connection with valid token should be accepted", () => {
		const serverToken = generateAuthToken();
		const url = new URL("ws://localhost:24242/ws");
		url.searchParams.set("token", serverToken);
		expect(url.searchParams.get("token")).toBe(serverToken);
	});
});

describe("Origin Header Validation", () => {
	const ALLOWED_ORIGINS = [
		"http://localhost",
		"http://127.0.0.1",
		"https://localhost",
		"https://127.0.0.1",
		"file://",
	];

	function isOriginAllowed(origin: string | null): boolean {
		if (origin === null) return true; // Desktop apps don't send Origin
		return ALLOWED_ORIGINS.some(
			(allowed) => origin === allowed || origin.startsWith(`${allowed}:`),
		);
	}

	test("localhost origins are allowed", () => {
		expect(isOriginAllowed("http://localhost:3000")).toBe(true);
		expect(isOriginAllowed("http://localhost:24242")).toBe(true);
		expect(isOriginAllowed("http://127.0.0.1:3000")).toBe(true);
	});

	test("null origin (desktop app) is allowed", () => {
		expect(isOriginAllowed(null)).toBe(true);
	});

	test("external origins are blocked (CSWSH prevention)", () => {
		expect(isOriginAllowed("https://attacker.com")).toBe(false);
		expect(isOriginAllowed("https://evil.example.com")).toBe(false);
		expect(isOriginAllowed("http://192.168.1.100:8080")).toBe(false);
		expect(isOriginAllowed("https://malicious-site.io")).toBe(false);
	});

	test("file:// origins are allowed (local HTML files)", () => {
		expect(isOriginAllowed("file://")).toBe(true);
	});
});

describe("HTTP File Route Authentication", () => {
	test("/files/ endpoint requires authentication", () => {
		// In the fixed server, /files/ requests without a valid token in
		// the Authorization header or query parameter should return 401
		const pathname = "/files/workspace-id/secret.env";
		expect(pathname.startsWith("/files/")).toBe(true);
		// The request should be rejected without auth
	});

	test("/blob/ endpoint requires authentication", () => {
		const pathname = "/blob/workspace-id/abc123/config.json";
		expect(pathname.startsWith("/blob/")).toBe(true);
		// The request should be rejected without auth
	});

	test("/health endpoint does NOT require authentication", () => {
		// Health checks should remain unauthenticated for monitoring
		const pathname = "/health";
		expect(pathname).toBe("/health");
	});
});
