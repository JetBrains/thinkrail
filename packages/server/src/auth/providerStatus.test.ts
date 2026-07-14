import { describe, expect, test } from "bun:test";
import type { JbcentralInstall } from "@thinkrail/contracts";
import { buildProviderReport, type ProviderStatusSources } from "./providerStatus";

/** A fixed per-OS install command — threaded straight through the report (not derived here). */
const INSTALL: JbcentralInstall = {
	platform: "linux",
	shell: "bash",
	command: "curl -fsSL https://example/install.sh | bash",
};

/** Fixture sources: everything empty/unconfigured unless overridden. */
function sources(overrides: Partial<ProviderStatusSources> = {}): ProviderStatusSources {
	return {
		modelProviders: new Map(),
		availableProviders: new Set(),
		credentialProviders: [],
		oauthProviders: [],
		credentialType: () => undefined,
		providerAuth: () => ({}),
		displayName: (id) => id,
		hasAuth: () => false,
		jbcentralInstalled: false,
		jbcentralInstall: INSTALL,
		...overrides,
	};
}

const PROXY_URL = "http://127.0.0.1:19516/wire/s/claude-code/anthropic";

describe("buildProviderReport", () => {
	test("empty runtime → no providers, not wired", () => {
		expect(buildProviderReport(sources())).toEqual({
			providers: [],
			jbcentralWired: false,
			jbcentralInstalled: false,
			jbcentralInstall: INSTALL,
		});
	});

	test("the host's per-OS install command flows through from the sources", () => {
		const win: JbcentralInstall = {
			platform: "win32",
			shell: "powershell",
			command: "irm https://example/install.ps1 | iex",
		};
		expect(buildProviderReport(sources({ jbcentralInstall: win })).jbcentralInstall).toEqual(win);
	});

	test("jbcentralInstalled flows through from the sources", () => {
		expect(buildProviderReport(sources({ jbcentralInstalled: true })).jbcentralInstalled).toBe(
			true,
		);
	});

	test("jbcentral-wired provider reports kind central and flips jbcentralWired", () => {
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
			{ id: "anthropic", name: "Anthropic", configured: true, kind: "central", canApiKey: true },
			{ id: "google", name: "Google", configured: false, canApiKey: true },
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
			{
				id: "groq",
				name: "groq",
				configured: true,
				kind: "env",
				detail: "GROQ_API_KEY",
				canApiKey: true,
			},
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
			canApiKey: true,
		});
	});

	test("a model-less credential provider still shows, via hasAuth (no canApiKey — no model row)", () => {
		const report = buildProviderReport(
			sources({
				credentialProviders: ["mystery"],
				credentialType: () => "api_key",
				providerAuth: () => ({ source: "stored" }),
				hasAuth: (id) => id === "mystery",
			}),
		);
		expect(report.providers).toEqual([
			// It has an auth.json credential → removable in-app (canLogout).
			{ id: "mystery", name: "mystery", configured: true, kind: "api-key", canLogout: true },
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

describe("in-app login capability flags", () => {
	test("OAuth providers appear as their own rows, canOAuth, named from the oauth registry", () => {
		// openai-codex / github-copilot have no model rows until authed — and their ids differ from any
		// model-provider id — so they only surface because the id universe unions the oauth provider ids.
		const report = buildProviderReport(
			sources({
				oauthProviders: [
					{ id: "openai-codex", name: "ChatGPT Plus/Pro (Codex Subscription)" },
					{ id: "github-copilot", name: "GitHub Copilot" },
				],
			}),
		);
		// Sorted by display name: "ChatGPT…" (C) before "GitHub Copilot" (G).
		expect(report.providers).toEqual([
			{
				id: "openai-codex",
				name: "ChatGPT Plus/Pro (Codex Subscription)",
				configured: false,
				canOAuth: true,
			},
			{
				id: "github-copilot",
				name: "GitHub Copilot",
				configured: false,
				canOAuth: true,
			},
		]);
	});

	test("canApiKey excludes multi-field credential providers (bedrock / vertex / azure)", () => {
		const report = buildProviderReport(
			sources({
				modelProviders: new Map([
					["amazon-bedrock", ["https://bedrock.aws"]],
					["google-vertex", ["https://vertex.google"]],
					["azure-openai-responses", ["https://azure.openai"]],
					["openai", ["https://api.openai.com"]],
				]),
			}),
		);
		const canApiKey = Object.fromEntries(report.providers.map((p) => [p.id, p.canApiKey ?? false]));
		expect(canApiKey).toEqual({
			"amazon-bedrock": false,
			"google-vertex": false,
			"azure-openai-responses": false,
			openai: true,
		});
	});

	test("canApiKey excludes OAuth-only providers even when they have model rows", () => {
		const report = buildProviderReport(
			sources({
				modelProviders: new Map([["github-copilot", ["https://api.githubcopilot.com"]]]),
				oauthProviders: [{ id: "github-copilot", name: "GitHub Copilot" }],
			}),
		);
		expect(report.providers[0]).toEqual({
			id: "github-copilot",
			name: "GitHub Copilot",
			configured: false,
			canOAuth: true,
		});
	});

	test("canLogout marks only providers with a stored auth.json credential (not env / models.json)", () => {
		const report = buildProviderReport(
			sources({
				modelProviders: new Map([
					["anthropic", ["https://api.anthropic.com"]],
					["groq", ["https://api.groq.com"]],
				]),
				availableProviders: new Set(["anthropic", "groq"]),
				// anthropic has an auth.json credential; groq is configured via an env var only.
				credentialProviders: ["anthropic"],
				credentialType: (id) => (id === "anthropic" ? "api_key" : undefined),
				providerAuth: (id) =>
					id === "anthropic"
						? { source: "stored" }
						: { source: "environment", label: "GROQ_API_KEY" },
			}),
		);
		const canLogout = Object.fromEntries(report.providers.map((p) => [p.id, p.canLogout ?? false]));
		expect(canLogout).toEqual({ anthropic: true, groq: false });
	});

	test("a dual provider (anthropic) reports both canOAuth and canApiKey, keeping its registry name", () => {
		const report = buildProviderReport(
			sources({
				modelProviders: new Map([["anthropic", ["https://api.anthropic.com"]]]),
				oauthProviders: [{ id: "anthropic", name: "Anthropic (Claude Pro/Max)" }],
				displayName: (id) => (id === "anthropic" ? "Anthropic" : id),
			}),
		);
		expect(report.providers[0]).toEqual({
			id: "anthropic",
			name: "Anthropic",
			configured: false,
			canOAuth: true,
			canApiKey: true,
		});
	});
});
