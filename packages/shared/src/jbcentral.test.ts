import { describe, expect, test } from "bun:test";
import {
	applyJbcentralOverrides,
	buildProxyUrls,
	isJbcentralWired,
	jbcentralInstallCommand,
	jbcentralInstallHint,
	type ModelsConfig,
	removeJbcentralOverrides,
	resolveProxyPort,
} from "./jbcentral";

describe("resolveProxyPort", () => {
	test("env wins over config over default", () => {
		expect(resolveProxyPort({ WIRE_PROXY_PORT: "20000" }, { proxy_port: 30000 })).toBe(20000);
		expect(resolveProxyPort({}, { proxy_port: 30000 })).toBe(30000);
		expect(resolveProxyPort({}, {})).toBe(19516);
	});

	test("empty env value falls through to config/default", () => {
		expect(resolveProxyPort({ WIRE_PROXY_PORT: "" }, { proxy_port: 30000 })).toBe(30000);
		expect(resolveProxyPort({ WIRE_PROXY_PORT: "" }, {})).toBe(19516);
	});

	test("rejects a non-numeric or out-of-range env port", () => {
		expect(() => resolveProxyPort({ WIRE_PROXY_PORT: "nope" }, {})).toThrow(
			"Invalid WIRE_PROXY_PORT: nope",
		);
		expect(() => resolveProxyPort({ WIRE_PROXY_PORT: "70000" }, {})).toThrow(
			"Invalid WIRE_PROXY_PORT: 70000",
		);
	});
});

describe("buildProxyUrls", () => {
	test("composes the per-provider proxy URLs (no /v1)", () => {
		expect(buildProxyUrls(19516, "sEcReT")).toEqual({
			anthropicUrl: "http://127.0.0.1:19516/wire/sEcReT/claude-code/anthropic",
			openaiUrl: "http://127.0.0.1:19516/wire/sEcReT/codex/openai",
		});
	});
});

describe("applyJbcentralOverrides", () => {
	const urls = buildProxyUrls(19516, "s");

	test("sets baseUrl + apiKey on anthropic and openai", () => {
		const config = applyJbcentralOverrides({}, urls);
		expect(config.providers?.anthropic).toEqual({
			baseUrl: urls.anthropicUrl,
			apiKey: "wire-proxy",
		});
		expect(config.providers?.openai).toEqual({ baseUrl: urls.openaiUrl, apiKey: "wire-proxy" });
	});

	test("preserves other provider fields + unrelated providers", () => {
		const config: ModelsConfig = {
			providers: {
				anthropic: { models: ["x"] } as never,
				custom: { baseUrl: "keep" },
			},
		};
		applyJbcentralOverrides(config, urls);
		expect(config.providers?.anthropic).toEqual({
			models: ["x"],
			baseUrl: urls.anthropicUrl,
			apiKey: "wire-proxy",
		} as never);
		expect(config.providers?.custom).toEqual({ baseUrl: "keep" });
	});
});

describe("removeJbcentralOverrides", () => {
	test("drops only baseUrl/apiKey, keeping other fields", () => {
		const config: ModelsConfig = {
			providers: {
				anthropic: { baseUrl: "x", apiKey: "y", models: ["m"] } as never,
				openai: { baseUrl: "x", apiKey: "y" },
			},
		};
		removeJbcentralOverrides(config);
		expect(config.providers?.anthropic).toEqual({ models: ["m"] } as never);
		// openai had only the managed fields → the now-empty entry is removed.
		expect(config.providers?.openai).toBeUndefined();
	});

	test("is a no-op when there are no providers", () => {
		expect(removeJbcentralOverrides({})).toEqual({});
	});
});

describe("isJbcentralWired", () => {
	const urls = buildProxyUrls(19516, "s");

	test("detects a proxied anthropic/openai baseUrl", () => {
		expect(isJbcentralWired(applyJbcentralOverrides({}, urls))).toBe(true);
		expect(isJbcentralWired({ providers: { openai: { baseUrl: urls.openaiUrl } } })).toBe(true);
	});

	test("ignores non-proxy baseUrls, other providers, and empty configs", () => {
		expect(isJbcentralWired({})).toBe(false);
		expect(isJbcentralWired({ providers: { anthropic: { baseUrl: "https://api.example" } } })).toBe(
			false,
		);
		expect(
			isJbcentralWired({ providers: { custom: { baseUrl: "http://127.0.0.1:19516/wire/s/x" } } }),
		).toBe(false);
	});
});

describe("jbcentralInstallCommand", () => {
	test("unix pipes the install.sh through bash; the display string is what runs", () => {
		const { display, argv } = jbcentralInstallCommand("darwin");
		expect(display).toContain("central/stable/install.sh");
		expect(argv[0]).toBe("bash");
		expect(argv[argv.length - 1]).toBe(display);
	});

	test("windows uses the PowerShell installer", () => {
		const { display, argv } = jbcentralInstallCommand("win32");
		expect(display).toContain("install.ps1");
		expect(argv[0]).toBe("powershell");
	});
});

describe("jbcentralInstallHint", () => {
	test("unix points at the install.sh one-liner", () => {
		expect(jbcentralInstallHint("linux")).toContain("install.sh | bash");
		expect(jbcentralInstallHint("darwin")).toContain("install.sh | bash");
	});

	test("windows points at the PowerShell installer, not the sh script", () => {
		const hint = jbcentralInstallHint("win32");
		expect(hint).toContain("install.ps1");
		expect(hint).not.toContain("install.sh");
	});
});
