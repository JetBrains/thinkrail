import { expect, test } from "bun:test";
import {
	isLaunchProtectedPath,
	isLaunchTokenValid,
	isOriginAllowed,
	parseAllowedOrigins,
} from "./launchAuth";

const policy = { token: "t", host: "localhost", port: 4000, extraOrigins: [] };

test("loopback origins on the serving port are allowed, others are not", () => {
	for (const origin of ["http://localhost:4000", "http://127.0.0.1:4000", "http://[::1]:4000"]) {
		expect(isOriginAllowed({ origin, requestHost: null, policy })).toBe(true);
	}
	for (const origin of ["http://localhost:4001", "https://evil.example", "null"]) {
		expect(isOriginAllowed({ origin, requestHost: "localhost:4000", policy })).toBe(false);
	}
	expect(isOriginAllowed({ origin: null, requestHost: null, policy })).toBe(true);
});

test("a DNS-rebound origin is foreign on a loopback bind", () => {
	expect(
		isOriginAllowed({
			origin: "http://rebind.example:4000",
			requestHost: "rebind.example:4000",
			policy,
		}),
	).toBe(false);
});

test("a wildcard bind accepts the origin matching the request Host", () => {
	const wildcard = { ...policy, host: "0.0.0.0" };
	expect(
		isOriginAllowed({
			origin: "http://192.168.1.5:4000",
			requestHost: "192.168.1.5:4000",
			policy: wildcard,
		}),
	).toBe(true);
	expect(
		isOriginAllowed({
			origin: "http://evil.example",
			requestHost: "192.168.1.5:4000",
			policy: wildcard,
		}),
	).toBe(false);
});

test("extra origins are normalized and invalid entries dropped", () => {
	expect(parseAllowedOrigins(" http://localhost:24269/ , nope,,https://a.test/x ")).toEqual([
		"http://localhost:24269",
		"https://a.test",
	]);
	expect(parseAllowedOrigins(undefined)).toEqual([]);
});

test("token compare rejects missing, shorter and different values", () => {
	expect(isLaunchTokenValid("secret", "secret")).toBe(true);
	expect(isLaunchTokenValid("secret", null)).toBe(false);
	expect(isLaunchTokenValid("secret", "secre")).toBe(false);
	expect(isLaunchTokenValid("secret", "secreT")).toBe(false);
});

test("only the wire, probe, file and extension routes are protected", () => {
	expect(isLaunchProtectedPath("/ws")).toBe(true);
	expect(isLaunchProtectedPath("/auth")).toBe(true);
	expect(isLaunchProtectedPath("/files/w/a.png")).toBe(true);
	expect(isLaunchProtectedPath("/ext/x/1/v.js")).toBe(true);
	expect(isLaunchProtectedPath("/health")).toBe(false);
	expect(isLaunchProtectedPath("/")).toBe(false);
	expect(isLaunchProtectedPath("/assets/index.js")).toBe(false);
});
