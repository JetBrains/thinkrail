import { describe, expect, it } from "bun:test";
import {
	applyProxySettings,
	effectiveProxyUrl,
	normalizeManualProxy,
	resolveProxyMode,
} from "./applyProxy";

describe("resolveProxyMode", () => {
	it("returns null for a missing or unknown value", () => {
		expect(resolveProxyMode(undefined)).toBeNull();
		expect(resolveProxyMode("")).toBeNull();
		expect(resolveProxyMode("bogus")).toBeNull();
	});

	it("accepts the explicit modes", () => {
		expect(resolveProxyMode("system")).toBe("system");
		expect(resolveProxyMode("manual")).toBe("manual");
		expect(resolveProxyMode("none")).toBe("none");
	});
});

describe("normalizeManualProxy", () => {
	it("normalizes a bare host:port", () => {
		expect(normalizeManualProxy("127.0.0.1:7897")).toBe("http://127.0.0.1:7897");
	});

	it("keeps an http scheme", () => {
		expect(normalizeManualProxy("http://localhost:3128")).toBe("http://localhost:3128");
	});

	it("rejects a missing host or port", () => {
		expect(normalizeManualProxy("127.0.0.1")).toBeNull();
		expect(normalizeManualProxy(":7897")).toBeNull();
		expect(normalizeManualProxy("")).toBeNull();
	});

	it("rejects non-strings", () => {
		expect(normalizeManualProxy(undefined)).toBeNull();
		expect(normalizeManualProxy(42)).toBeNull();
	});
});

describe("effectiveProxyUrl", () => {
	const readSystem = () => "http://10.0.0.1:8080";

	it("uses the system proxy for system mode", () => {
		expect(effectiveProxyUrl("system", undefined, readSystem)).toBe("http://10.0.0.1:8080");
	});

	it("uses the manual value for manual mode", () => {
		expect(effectiveProxyUrl("manual", "127.0.0.1:7897", readSystem)).toBe("http://127.0.0.1:7897");
	});

	it("returns null for none mode", () => {
		expect(effectiveProxyUrl("none", undefined, readSystem)).toBeNull();
	});
});

describe("applyProxySettings", () => {
	it("leaves the environment untouched when no mode is set", () => {
		const env: Record<string, string | undefined> = {
			HTTPS_PROXY: "http://launch.example:3128",
		};
		expect(
			applyProxySettings(undefined, undefined, { readSystemProxy: () => null, env }),
		).toBeNull();
		expect(env.HTTPS_PROXY).toBe("http://launch.example:3128");
	});

	it("sets all three variables", () => {
		const env: Record<string, string | undefined> = {};
		applyProxySettings("manual", "127.0.0.1:7897", { readSystemProxy: () => null, env });
		expect(env.HTTPS_PROXY).toBe("http://127.0.0.1:7897");
		expect(env.HTTP_PROXY).toBe("http://127.0.0.1:7897");
		expect(env.ALL_PROXY).toBe("http://127.0.0.1:7897");
	});

	it("clears the variables for none mode", () => {
		const env: Record<string, string | undefined> = {
			HTTPS_PROXY: "http://127.0.0.1:7897",
			HTTP_PROXY: "http://127.0.0.1:7897",
			ALL_PROXY: "http://127.0.0.1:7897",
		};
		applyProxySettings("none", undefined, { readSystemProxy: () => null, env });
		expect(env.HTTPS_PROXY).toBeUndefined();
		expect(env.HTTP_PROXY).toBeUndefined();
		expect(env.ALL_PROXY).toBeUndefined();
	});

	it("returns the applied URL", () => {
		const env: Record<string, string | undefined> = {};
		expect(
			applyProxySettings("manual", "127.0.0.1:7897", { readSystemProxy: () => null, env }),
		).toBe("http://127.0.0.1:7897");
	});
});
