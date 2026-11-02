import { describe, expect, it } from "bun:test";
import { proxyUrlFromSettings, type WindowsInternetSettings } from "./systemProxy";

describe("proxyUrlFromSettings", () => {
	it("returns null when the proxy is disabled", () => {
		const settings: WindowsInternetSettings = { proxyEnable: 0, proxyServer: "127.0.0.1:7897" };
		expect(proxyUrlFromSettings(settings)).toBeNull();
	});

	it("normalizes a bare host:port", () => {
		const settings: WindowsInternetSettings = { proxyEnable: 1, proxyServer: "127.0.0.1:7897" };
		expect(proxyUrlFromSettings(settings)).toBe("http://127.0.0.1:7897");
	});

	it("prefers the http= segment", () => {
		const settings: WindowsInternetSettings = {
			proxyEnable: 1,
			proxyServer: "socks=127.0.0.1:7891;http=127.0.0.1:7897",
		};
		expect(proxyUrlFromSettings(settings)).toBe("http://127.0.0.1:7897");
	});

	it("rejects a socks-only proxy", () => {
		const settings: WindowsInternetSettings = {
			proxyEnable: 1,
			proxyServer: "socks=127.0.0.1:7891",
		};
		expect(proxyUrlFromSettings(settings)).toBeNull();
	});

	it("strips an existing scheme", () => {
		const settings: WindowsInternetSettings = {
			proxyEnable: 1,
			proxyServer: "http://127.0.0.1:7897",
		};
		expect(proxyUrlFromSettings(settings)).toBe("http://127.0.0.1:7897");
	});

	it("rejects an empty server", () => {
		const settings: WindowsInternetSettings = { proxyEnable: 1, proxyServer: "  " };
		expect(proxyUrlFromSettings(settings)).toBeNull();
	});
});
