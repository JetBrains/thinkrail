import { describe, expect, test } from "bun:test";
import { isJbcentralProxyUrl } from "@thinkrail/shared/jbcentral";
import {
	applyJbcentralOverrides,
	buildProxyUrls,
	jbcentralInstallHint,
	type ModelsConfig,
	parseJbcentralArgs,
	removeJbcentralOverrides,
	resolveProxyPort,
} from "./jbcentral";

describe("parseJbcentralArgs", () => {
	test("defaults to wire (no remove, no help)", () => {
		expect(parseJbcentralArgs([])).toEqual({ remove: false, help: false });
	});

	test("reads --remove and -h/--help", () => {
		expect(parseJbcentralArgs(["--remove"])).toEqual({ remove: true, help: false });
		expect(parseJbcentralArgs(["-h"])).toEqual({ remove: false, help: true });
		expect(parseJbcentralArgs(["--help"])).toEqual({ remove: false, help: true });
	});

	test("rejects an unknown flag", () => {
		expect(() => parseJbcentralArgs(["--nope"])).toThrow("Unknown option: --nope");
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

	// Drift gate: the server detects jbcentral wiring via `shared/jbcentral`'s predicate. If the URL
	// shape this writer produces ever stops matching that reader, provider status would silently report
	// "API key" instead of "JetBrains AI proxy" — this pins the two together.
	test("built URLs satisfy the shared detection predicate", () => {
		const urls = buildProxyUrls(19516, "sEcReT");
		expect(isJbcentralProxyUrl(urls.anthropicUrl)).toBe(true);
		expect(isJbcentralProxyUrl(urls.openaiUrl)).toBe(true);
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

describe("jbcentralInstallHint", () => {
	test("unix points at the install.sh one-liner", () => {
		expect(jbcentralInstallHint("linux")).toContain("install.sh | bash");
		expect(jbcentralInstallHint("darwin")).toContain("install.sh | bash");
	});

	test("windows points at the JetBrains installer, not the sh script", () => {
		const hint = jbcentralInstallHint("win32");
		expect(hint).toContain("Windows");
		expect(hint).not.toContain("install.sh");
	});
});
