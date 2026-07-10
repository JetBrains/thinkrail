// Boundary tests for the provider-auth surface: the status read, the API-key write, and the OAuth
// bridge — driven end-to-end against an in-memory pi runtime with a registered fake OAuth provider
// (no network, no disk, no real browser: THINKRAIL_NO_BROWSER short-circuits openBrowser).

import { afterEach, beforeEach, expect, test } from "bun:test";
import { AuthStorage, ModelRegistry } from "@earendil-works/pi-coding-agent";
import type { AuthEvent } from "@thinkrail/contracts";
import { configurePiRuntime } from "../agent";
import { logoutProvider, setApiKey } from "./credentials";
import { setAuthEventPublisher } from "./events";
import { answerAuth, cancelAuthFlow, startOAuthLogin } from "./loginFlow";
import { buildAuthStatus } from "./status";

process.env.THINKRAIL_NO_BROWSER = "1";

let events: AuthEvent[] = [];
let authStorage: AuthStorage;
let modelRegistry: ModelRegistry;

beforeEach(() => {
	events = [];
	setAuthEventPublisher((e) => events.push(e));
	authStorage = AuthStorage.inMemory();
	modelRegistry = ModelRegistry.inMemory(authStorage);
	configurePiRuntime({ authStorage, modelRegistry });
});

afterEach(() => {
	setAuthEventPublisher(null);
	modelRegistry.unregisterProvider("faketest");
});

/** Wait until the captured events include a matching frame (flows settle async). */
async function eventOf<K extends AuthEvent["kind"]>(
	kind: K,
	timeoutMs = 2000,
): Promise<Extract<AuthEvent, { kind: K }>> {
	const start = Date.now();
	for (;;) {
		const found = events.find((e) => e.kind === kind);
		if (found) return found as Extract<AuthEvent, { kind: K }>;
		if (Date.now() - start > timeoutMs) throw new Error(`no ${kind} event within ${timeoutMs}ms`);
		await new Promise((r) => setTimeout(r, 10));
	}
}

test("auth.status: featured OAuth trio + API-key catalog, no credential values, gate count", async () => {
	const status = await buildAuthStatus();

	const featured = status.providers.filter((p) => p.featured);
	expect(featured.map((p) => p.id).sort()).toEqual(["anthropic", "github-copilot", "openai-codex"]);
	for (const p of featured) expect(p.kind).toBe("oauth");

	const apiKeyIds = status.providers.filter((p) => p.kind === "api_key").map((p) => p.id);
	// anthropic/openai take keys too; the OAuth-only pair must NOT appear in the key catalog.
	expect(apiKeyIds).toContain("anthropic");
	expect(apiKeyIds).toContain("openai");
	expect(apiKeyIds).not.toContain("openai-codex");
	expect(apiKeyIds).not.toContain("github-copilot");

	const anthropicKeyRow = status.providers.find(
		(p) => p.kind === "api_key" && p.id === "anthropic",
	);
	expect(anthropicKeyRow?.envVar).toBe("ANTHROPIC_API_KEY");
	// Status rows never carry values — only flags/labels.
	for (const p of status.providers) expect(JSON.stringify(p)).not.toContain("sk-");
});

test("auth.setApiKey: unlocks the provider's models, broadcasts `changed`, and never echoes the key", async () => {
	const before = await buildAuthStatus();
	const anthropicBefore = before.providers.find(
		(p) => p.kind === "api_key" && p.id === "anthropic",
	);
	// In-memory runtime — but the host process may carry real provider env keys; assert transitions
	// only when the provider starts unauthenticated, the invariant assertions below hold regardless.
	const status = await setApiKey("anthropic", "sk-ant-test-123");
	const row = status.providers.find((p) => p.kind === "api_key" && p.id === "anthropic");
	expect(row?.authenticated).toBe(true);
	if (!anthropicBefore?.authenticated) expect(status.modelCount).toBeGreaterThan(0);

	const changed = await eventOf("changed");
	expect(changed.modelCount).toBe(status.modelCount);
	expect(JSON.stringify(status)).not.toContain("sk-ant-test-123");

	await logoutProvider("anthropic");
});

test("OAuth bridge: auth-url + blocking prompt round-trip via auth.answer, then done + changed", async () => {
	modelRegistry.registerProvider("faketest", {
		name: "Fake Test",
		baseUrl: "http://faux.local",
		api: "openai-completions",
		oauth: {
			name: "Fake Test Login",
			login: async (callbacks) => {
				callbacks.onAuth({ url: "https://example.test/authorize" });
				const code = await callbacks.onPrompt({ message: "Paste the code" });
				return { refresh: "r", access: `token-${code}`, expires: Date.now() + 3_600_000 };
			},
			refreshToken: async (c) => c,
			getApiKey: (c) => c.access,
		},
		models: [],
	});

	const { flowId } = startOAuthLogin("faketest");
	expect((await eventOf("flow-started")).flowId).toBe(flowId);
	expect((await eventOf("auth-url")).url).toBe("https://example.test/authorize");

	const prompt = await eventOf("prompt");
	expect(prompt.message).toBe("Paste the code");
	answerAuth(prompt.requestId, "abc123");

	const done = await eventOf("done");
	expect(done.ok).toBe(true);
	await eventOf("changed");

	const credential = authStorage.get("faketest");
	expect(credential?.type).toBe("oauth");
	expect((credential as { access?: string }).access).toBe("token-abc123");
});

test("auth.cancel aborts a flow mid-question; a dismissed prompt settles it as cancelled", async () => {
	modelRegistry.registerProvider("faketest", {
		name: "Fake Test",
		baseUrl: "http://faux.local",
		api: "openai-completions",
		oauth: {
			name: "Fake Test Login",
			login: async (callbacks) => {
				const code = await callbacks.onPrompt({ message: "Paste the code" });
				return { refresh: "r", access: code, expires: Date.now() + 3_600_000 };
			},
			refreshToken: async (c) => c,
			getApiKey: (c) => c.access,
		},
		models: [],
	});

	const { flowId } = startOAuthLogin("faketest");
	await eventOf("prompt");
	cancelAuthFlow(flowId);

	const done = await eventOf("done");
	expect(done.flowId).toBe(flowId);
	expect(done.ok).toBe(false);
	expect(done.message).toBe("cancelled");
	expect(authStorage.get("faketest")).toBeUndefined();
});

test("auth.answer with an unknown requestId throws (stale client)", () => {
	expect(() => answerAuth("nope", "x")).toThrow("Unknown auth request");
});
