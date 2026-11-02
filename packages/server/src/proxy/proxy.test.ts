import { describe, expect, it } from "bun:test";
import { type AppConfig, DEFAULT_CONFIG } from "@thinkrail/contracts";
import { applyProxyConfig, normalizeManualProxy, resolveProxy } from "./proxy";

function config(proxy: AppConfig["proxy"]): AppConfig {
	return proxy ? { ...DEFAULT_CONFIG, proxy } : { ...DEFAULT_CONFIG };
}

describe("normalizeManualProxy", () => {
	it("normalizes a bare host:port", () => {
		expect(normalizeManualProxy("127.0.0.1:7897")).toBe("http://127.0.0.1:7897");
	});

	it("keeps an http scheme", () => {
		expect(normalizeManualProxy("http://localhost:3128")).toBe("http://localhost:3128");
	});

	it("accepts explicitly supplied default ports", () => {
		expect(normalizeManualProxy("proxy.example:80")).toBe("http://proxy.example:80");
		expect(normalizeManualProxy("proxy.example:443")).toBe("http://proxy.example:443");
	});

	it("rejects a missing host or port", () => {
		expect(normalizeManualProxy("127.0.0.1")).toBeNull();
		expect(normalizeManualProxy(":7897")).toBeNull();
		expect(normalizeManualProxy("")).toBeNull();
	});
});

describe("resolveProxy", () => {
	it("resolves none to empty", () => {
		expect(resolveProxy("none", undefined, () => null)).toEqual({
			httpProxy: null,
			httpsProxy: null,
			noProxy: [],
		});
	});

	it("resolves manual for both protocols", () => {
		const result = resolveProxy("manual", "127.0.0.1:7897", () => null);
		expect(result.httpProxy).toBe("http://127.0.0.1:7897");
		expect(result.httpsProxy).toBe("http://127.0.0.1:7897");
	});

	it("falls back to empty when the system proxy is absent", () => {
		expect(resolveProxy("system", undefined, () => null)).toEqual({
			httpProxy: null,
			httpsProxy: null,
			noProxy: [],
		});
	});
});

describe("applyProxyConfig", () => {
	it("leaves the environment untouched when no config is set", () => {
		const env: Record<string, string | undefined> = {
			HTTPS_PROXY: "http://launch:3128",
			https_proxy: "http://launch:3128",
		};
		applyProxyConfig(config(undefined), () => null, env);
		expect(env.HTTPS_PROXY).toBe("http://launch:3128");
		expect(env.https_proxy).toBe("http://launch:3128");
	});

	it("sets both casing variants for a manual proxy", () => {
		const env: Record<string, string | undefined> = {};
		applyProxyConfig(config({ mode: "manual", manualTarget: "127.0.0.1:7897" }), () => null, env);
		expect(env.HTTPS_PROXY).toBe("http://127.0.0.1:7897");
		expect(env.https_proxy).toBe("http://127.0.0.1:7897");
		expect(env.HTTP_PROXY).toBe("http://127.0.0.1:7897");
		expect(env.http_proxy).toBe("http://127.0.0.1:7897");
	});

	it("clears both casing variants for none mode", () => {
		const env: Record<string, string | undefined> = {
			HTTPS_PROXY: "x",
			https_proxy: "x",
			HTTP_PROXY: "x",
			http_proxy: "x",
		};
		applyProxyConfig(config({ mode: "none" }), () => null, env);
		expect(env.HTTPS_PROXY).toBeUndefined();
		expect(env.https_proxy).toBeUndefined();
		expect(env.HTTP_PROXY).toBeUndefined();
		expect(env.http_proxy).toBeUndefined();
	});

	it("applies the system noProxy list", () => {
		const env: Record<string, string | undefined> = {};
		applyProxyConfig(
			config({ mode: "system" }),
			() => ({
				httpProxy: "http://10.0.0.1:8080",
				httpsProxy: "http://10.0.0.1:8080",
				noProxy: ["localhost", "example.com"],
			}),
			env,
		);
		expect(env.NO_PROXY).toBe("localhost,example.com");
		expect(env.no_proxy).toBe("localhost,example.com");
	});
});
