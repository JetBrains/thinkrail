import { describe, expect, test } from "bun:test";
import { buildProviderReport, type ProviderStatusSources } from "./providerStatus";

/** Fixture sources: everything empty/unconfigured unless overridden. */
function sources(overrides: Partial<ProviderStatusSources> = {}): ProviderStatusSources {
	return {
		modelProviders: new Map(),
		availableProviders: new Set(),
		credentialProviders: [],
		credentialType: () => undefined,
		providerAuth: () => ({}),
		displayName: (id) => id,
		hasAuth: () => false,
		...overrides,
	};
}

const PROXY_URL = "http://127.0.0.1:19516/wire/s/claude-code/anthropic";

describe("buildProviderReport", () => {
	test("empty runtime → no providers, not wired", () => {
		expect(buildProviderReport(sources())).toEqual({ providers: [], jbcentralWired: false });
	});

	test("jbcentral-wired provider reports kind jbcentral and flips jbcentralWired", () => {
		const report = buildProviderReport(
			sources({
				modelProviders: new Map([
					["anthropic", [PROXY_URL]],
					["google", ["https://generativelanguage.googleapis.com"]],
				]),
				// The dummy `wire-proxy` key makes the provider available in the real registry.
				availableProviders: new Set(["anthropic"]),
				providerAuth: (id) => (id === "anthropic" ? { source: "models_json_key" } : {}),
				displayName: (id) => (id === "anthropic" ? "Anthropic" : "Google"),
			}),
		);
		expect(report.jbcentralWired).toBe(true);
		expect(report.providers).toEqual([
			{ id: "anthropic", name: "Anthropic", configured: true, kind: "jbcentral" },
			{ id: "google", name: "Google", configured: false },
		]);
	});

	test("stored credentials map to oauth / api-key kinds", () => {
		const report = buildProviderReport(
			sources({
				modelProviders: new Map([
					["anthropic", ["https://api.anthropic.com"]],
					["openai", ["https://api.openai.com"]],
				]),
				availableProviders: new Set(["anthropic", "openai"]),
				credentialProviders: ["anthropic", "openai"],
				credentialType: (id) => (id === "anthropic" ? "oauth" : "api_key"),
				providerAuth: () => ({ source: "stored" }),
				hasAuth: () => true,
			}),
		);
		expect(report.providers.map((p) => [p.id, p.kind])).toEqual([
			["anthropic", "oauth"],
			["openai", "api-key"],
		]);
		expect(report.jbcentralWired).toBe(false);
	});

	test("env-var auth counts as configured (pi reports source without configured)", () => {
		const report = buildProviderReport(
			sources({
				modelProviders: new Map([["groq", ["https://api.groq.com"]]]),
				availableProviders: new Set(["groq"]), // hasConfiguredAuth sees the env key
				providerAuth: () => ({ source: "environment", label: "GROQ_API_KEY" }),
			}),
		);
		expect(report.providers).toEqual([
			{ id: "groq", name: "groq", configured: true, kind: "env", detail: "GROQ_API_KEY" },
		]);
	});

	test("models.json keyed provider gets an api-key kind with a models.json hint", () => {
		const report = buildProviderReport(
			sources({
				modelProviders: new Map([["custom", ["https://llm.example.com"]]]),
				availableProviders: new Set(["custom"]),
				providerAuth: () => ({ source: "models_json_key" }),
			}),
		);
		expect(report.providers[0]).toEqual({
			id: "custom",
			name: "custom",
			configured: true,
			kind: "api-key",
			detail: "models.json",
		});
	});

	test("a model-less credential provider still shows, via hasAuth", () => {
		const report = buildProviderReport(
			sources({
				credentialProviders: ["mystery"],
				credentialType: () => "api_key",
				providerAuth: () => ({ source: "stored" }),
				hasAuth: (id) => id === "mystery",
			}),
		);
		expect(report.providers).toEqual([
			{ id: "mystery", name: "mystery", configured: true, kind: "api-key" },
		]);
	});

	test("orders configured first, alphabetical within each group", () => {
		const report = buildProviderReport(
			sources({
				modelProviders: new Map([
					["zai", ["https://z.ai"]],
					["anthropic", ["https://api.anthropic.com"]],
					["google", ["https://g.example"]],
					["openai", ["https://api.openai.com"]],
				]),
				availableProviders: new Set(["zai", "openai"]),
				providerAuth: () => ({ source: "models_json_key" }),
			}),
		);
		expect(report.providers.map((p) => p.id)).toEqual(["openai", "zai", "anthropic", "google"]);
	});
});
