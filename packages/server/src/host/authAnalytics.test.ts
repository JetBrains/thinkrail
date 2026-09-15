import { expect, test } from "bun:test";
import { builtinProviders } from "@earendil-works/pi-ai/providers/all";
import {
	type AuthMetadataContext,
	loginAuthMethod,
	observedAuthMethod,
	sessionProviderAnalytics,
} from "./authAnalytics";

type AuthStatus = ReturnType<AuthMetadataContext["runtime"]["getProviderAuthStatus"]>;
const providers = new Map(builtinProviders().map((provider) => [provider.id, provider]));

function context(
	status: AuthStatus = { configured: true, source: "stored" },
	options: { oauth?: boolean; subscription?: boolean; opaque?: string[] } = {},
): AuthMetadataContext {
	return {
		opaqueProviderIds: new Set(options.opaque),
		runtime: {
			getProviderAuthStatus: () => status,
			getProvider: (id) => providers.get(id),
			getRegisteredProviderIds: () => [],
			isUsingOAuth: () => options.oauth === true || options.subscription === true,
			isUsingSubscription: () => options.subscription === true,
		},
	};
}

test.each([
	"runtime",
	"models_json_key",
	"models_json_command",
	"fallback",
] as const)("explicit %s key configuration does not inherit a cached subscription label", (source) => {
	expect(
		observedAuthMethod(
			"anthropic",
			context({ configured: true, source }, { oauth: true, subscription: true }),
		),
	).toBe("api_key");
});

test("cached auth distinguishes subscription sign-in, ordinary OAuth and stored API keys", () => {
	expect(observedAuthMethod("anthropic", context(undefined, { subscription: true }))).toBe(
		"subscription",
	);
	expect(observedAuthMethod("openrouter", context(undefined, { oauth: true }))).toBe("oauth");
	expect(observedAuthMethod("openai", context())).toBe("api_key");
	expect(observedAuthMethod("github-copilot", context())).toBe("api_key");
	expect(observedAuthMethod("openai-codex", context())).toBe("other");
});

test.each([
	["anthropic", "ANTHROPIC_API_KEY", "api_key"],
	["anthropic", "ANTHROPIC_OAUTH_TOKEN", "other"],
	["anthropic", "ANTHROPIC_AUTH_TOKEN", "other"],
	["google-vertex", "GOOGLE_CLOUD_API_KEY", "api_key"],
	["google-vertex", "/private/credential-file", "other"],
	["amazon-bedrock", "AWS_BEARER_TOKEN_BEDROCK", "api_key"],
	["amazon-bedrock", "AWS_PROFILE", "other"],
	["amazon-bedrock", "ECS task role", "other"],
] as const)("%s %s is classified from metadata without resolving its value", (provider, label, expected) => {
	expect(
		observedAuthMethod(provider, context({ configured: true, source: "environment", label })),
	).toBe(expected);
});

test("mixed cloud and private credential paths stay conservative", () => {
	for (const provider of ["amazon-bedrock", "google-vertex", "private-provider", "local-server"]) {
		expect(observedAuthMethod(provider, context())).toBe("other");
	}
	expect(
		observedAuthMethod(
			"private-provider",
			context({ configured: true, source: "models_json_key" }),
		),
	).toBe("api_key");
	expect(observedAuthMethod("private-provider", context({ configured: true }))).toBe("unknown");
	expect(observedAuthMethod("openai", undefined)).toBe("unknown");
	expect(
		observedAuthMethod("anthropic", context({ configured: false }, { subscription: true })),
	).toBe("unknown");
});

test("opaque provider ownership identifies Central without touching opaque auth or models", () => {
	let reads = 0;
	const forbidden = () => {
		reads++;
		throw new Error("private opaque details");
	};
	const opaque: AuthMetadataContext = {
		opaqueProviderIds: new Set(["private-central-provider"]),
		runtime: {
			getProviderAuthStatus: forbidden,
			getProvider: forbidden,
			getRegisteredProviderIds: forbidden,
			isUsingOAuth: forbidden,
			isUsingSubscription: forbidden,
		},
	};
	expect(observedAuthMethod("private-central-provider", opaque)).toBe("central");
	expect(loginAuthMethod("private-central-provider", "oauth", opaque)).toBe("central");
	expect(reads).toBe(0);
	expect(observedAuthMethod("direct-provider", opaque)).toBe("unknown");
});

test("custom replacements of builtin providers cannot inherit the builtin key classification", () => {
	const custom = context();
	custom.runtime.getRegisteredProviderIds = () => ["openai", "anthropic"];
	expect(observedAuthMethod("openai", custom)).toBe("other");
	expect(loginAuthMethod("openai", "api-key", custom)).toBe("other");
	const ambient = context({ configured: true, source: "environment", label: "ANTHROPIC_API_KEY" });
	ambient.runtime.getRegisteredProviderIds = () => ["anthropic"];
	expect(observedAuthMethod("anthropic", ambient)).toBe("other");
});

test("a Central-enabled generation does not label its ordinary providers Central", () => {
	const mixed = context(undefined, { opaque: ["private-central-provider"] });
	expect(observedAuthMethod("openai", mixed)).toBe("api_key");
	expect(observedAuthMethod("private-central-provider", mixed)).toBe("central");
});

test("login describes the completed flow, not an unrelated overriding credential", () => {
	const overwritten = context({ configured: true, source: "runtime" });
	expect(loginAuthMethod("anthropic", "oauth", overwritten)).toBe("subscription");
	expect(observedAuthMethod("anthropic", overwritten)).toBe("api_key");
	expect(loginAuthMethod("openrouter", "oauth", context())).toBe("oauth");
	expect(loginAuthMethod("openai", "api-key", context())).toBe("api_key");
	expect(loginAuthMethod("google-vertex", "api-key", context())).toBe("other");
	expect(loginAuthMethod("private-provider", "api-key", context())).toBe("other");
	expect(loginAuthMethod("jbcentral", "central", undefined)).toBe("central");
	expect(loginAuthMethod("anthropic", "oauth", undefined)).toBe("unknown");
});

test("builtin key paths do not silently include anonymous or keyless auth", async () => {
	for (const [id, provider] of providers) {
		if (observedAuthMethod(id, context()) !== "api_key") continue;
		const auth = provider.auth.apiKey;
		if (!auth) throw new Error("classified key path has no key auth");
		const resolved = await auth.resolve({
			ctx: { env: async () => undefined, fileExists: async () => false },
			signal: AbortSignal.timeout(1000),
		});
		expect(resolved).toBeUndefined();
	}
});

test("failed metadata reads never break telemetry callers or expose their messages", () => {
	const failed = context();
	failed.runtime.getProviderAuthStatus = () => {
		throw new Error("private auth error");
	};
	failed.runtime.getProvider = () => {
		throw new Error("private provider error");
	};
	expect(observedAuthMethod("openai", failed)).toBe("unknown");
	expect(loginAuthMethod("anthropic", "oauth", failed)).toBe("unknown");
	expect(sessionProviderAnalytics("missing-session")).toEqual({
		provider: "custom",
		model: "custom",
		auth_method: "unknown",
	});
});
