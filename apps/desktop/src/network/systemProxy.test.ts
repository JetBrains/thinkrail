import { describe, expect, it } from "bun:test";
import { proxyInfoFromSettings, type WindowsInternetSettings } from "./systemProxy";

function settings(overrides: Partial<WindowsInternetSettings>): WindowsInternetSettings {
	return { proxyEnable: 1, proxyServer: "127.0.0.1:7897", proxyOverride: "", ...overrides };
}

describe("proxyInfoFromSettings", () => {
	it("returns none when the proxy is disabled", () => {
		expect(proxyInfoFromSettings(settings({ proxyEnable: 0 }))).toEqual({
			httpProxy: null,
			httpsProxy: null,
			noProxy: [],
		});
	});

	it("normalizes a bare host:port for both protocols", () => {
		const result = proxyInfoFromSettings(settings({}));
		expect(result.httpProxy).toBe("http://127.0.0.1:7897");
		expect(result.httpsProxy).toBe("http://127.0.0.1:7897");
	});

	it("separates http= and https= selectors", () => {
		const result = proxyInfoFromSettings(
			settings({ proxyServer: "http=10.0.0.1:8080;https=10.0.0.2:8081" }),
		);
		expect(result.httpProxy).toBe("http://10.0.0.1:8080");
		expect(result.httpsProxy).toBe("http://10.0.0.2:8081");
	});

	it("rejects a socks-only proxy", () => {
		const result = proxyInfoFromSettings(settings({ proxyServer: "socks=127.0.0.1:7891" }));
		expect(result.httpProxy).toBeNull();
		expect(result.httpsProxy).toBeNull();
	});

	it("always includes the loopback exclusion", () => {
		const result = proxyInfoFromSettings(settings({}));
		expect(result.noProxy).toContain("localhost");
		expect(result.noProxy).toContain("127.0.0.1");
	});

	it("carries the ProxyOverride bypass list", () => {
		const result = proxyInfoFromSettings(
			settings({ proxyOverride: "example.com;192.168.1.0/24;<local>" }),
		);
		expect(result.noProxy).toContain("example.com");
		expect(result.noProxy).toContain("192.168.1.0/24");
		expect(result.noProxy).not.toContain("<local>");
	});
});
