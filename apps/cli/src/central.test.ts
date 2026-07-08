import { describe, expect, test } from "bun:test";
import {
	applyCentralOverrides,
	buildProxyUrls,
	centralInstallHint,
	type ModelsConfig,
	parseCentralArgs,
	removeCentralOverrides,
	resolveProxyPort,
} from "./central";

describe("parseCentralArgs", () => {
	test("defaults to wire (no remove, no help)", () => {
		expect(parseCentralArgs([])).toEqual({ remove: false, help: false });
	});

	test("reads --remove and -h/--help", () => {
		expect(parseCentralArgs(["--remove"])).toEqual({ remove: true, help: false });
		expect(parseCentralArgs(["-h"])).toEqual({ remove: false, help: true });
		expect(parseCentralArgs(["--help"])).toEqual({ remove: false, help: true });
	});

	test("rejects an unknown flag", () => {
		expect(() => parseCentralArgs(["--nope"])).toThrow("Unknown option: --nope");
	});
});

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

describe("applyCentralOverrides", () => {
	const urls = buildProxyUrls(19516, "s");

	test("sets baseUrl + apiKey on anthropic and openai", () => {
		const config = applyCentralOverrides({}, urls);
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
		applyCentralOverrides(config, urls);
		expect(config.providers?.anthropic).toEqual({
			models: ["x"],
			baseUrl: urls.anthropicUrl,
			apiKey: "wire-proxy",
		} as never);
		expect(config.providers?.custom).toEqual({ baseUrl: "keep" });
	});
});

describe("removeCentralOverrides", () => {
	test("drops only baseUrl/apiKey, keeping other fields", () => {
		const config: ModelsConfig = {
			providers: {
				anthropic: { baseUrl: "x", apiKey: "y", models: ["m"] } as never,
				openai: { baseUrl: "x", apiKey: "y" },
			},
		};
		removeCentralOverrides(config);
		expect(config.providers?.anthropic).toEqual({ models: ["m"] } as never);
		// openai had only the managed fields → the now-empty entry is removed.
		expect(config.providers?.openai).toBeUndefined();
	});

	test("is a no-op when there are no providers", () => {
		expect(removeCentralOverrides({})).toEqual({});
	});
});

describe("centralInstallHint", () => {
	test("unix points at the install.sh one-liner", () => {
		expect(centralInstallHint("linux")).toContain("install.sh | bash");
		expect(centralInstallHint("darwin")).toContain("install.sh | bash");
	});

	test("windows points at the JetBrains installer, not the sh script", () => {
		const hint = centralInstallHint("win32");
		expect(hint).toContain("Windows");
		expect(hint).not.toContain("install.sh");
	});
});
