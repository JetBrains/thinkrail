import { afterEach, expect, test } from "bun:test";
import { createFauxCore, fauxAssistantMessage } from "@earendil-works/pi-ai/providers/faux";
import { AuthStorage, ModelRegistry } from "@earendil-works/pi-coding-agent";
import { completeOnce, pickModel } from "./oneshot";
import { configurePiRuntime } from "./piRuntime";

/** A full model def for the registry (id + per-token input/output cost drives cheap-tier selection). */
function modelDef(id: string, cost = 0) {
	return {
		id,
		name: id,
		reasoning: false,
		input: ["text"] as ("text" | "image")[],
		cost: { input: cost, output: cost, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 100_000,
		maxTokens: 4096,
	};
}

/**
 * Point the shared runtime at a fake registry exposing exactly `models` as authenticated. `pickModel` is
 * pure logic over `getAvailable()`, so this stays deterministic regardless of the dev machine's real
 * provider env keys.
 */
function stubAvailable(models: ReturnType<typeof withProvider>[]): void {
	configurePiRuntime({
		// biome-ignore lint/suspicious/noExplicitAny: a minimal registry stub — pickModel only reads getAvailable
		authStorage: {} as any,
		// biome-ignore lint/suspicious/noExplicitAny: see above
		modelRegistry: { getAvailable: () => models } as any,
	});
}

function withProvider(provider: string, id: string, cost = 0) {
	return { ...modelDef(id, cost), api: `faux-${provider}`, provider, baseUrl: "http://faux.local" };
}

afterEach(() => {
	// Reset the singleton so a later test (or file) rebuilds from real auth rather than a stub.
	// biome-ignore lint/suspicious/noExplicitAny: intentional reset of the module singleton between tests
	configurePiRuntime(undefined as any);
});

test("pickModel(cheap) prefers a known small model (allowlist) over a cheaper unlisted one", () => {
	stubAvailable([
		withProvider("anthropic", "claude-haiku-faux", 10), // allowlisted, but pricier
		withProvider("cheapo", "cheapo-1", 1), // cheaper, but not on the allowlist
	]);
	expect(pickModel("cheap")?.id).toBe("claude-haiku-faux");
});

test("pickModel(cheap) falls back to the cheapest by token cost when nothing is allowlisted", () => {
	stubAvailable([withProvider("pricey", "pricey-1", 10), withProvider("cheapo", "cheapo-1", 1)]);
	expect(pickModel("cheap")?.id).toBe("cheapo-1");
});

test("pickModel(default) returns the first available model; empty set → null", () => {
	stubAvailable([withProvider("pricey", "pricey-1", 10), withProvider("cheapo", "cheapo-1", 1)]);
	expect(pickModel("default")?.id).toBe("pricey-1");
	stubAvailable([]);
	expect(pickModel("cheap")).toBeNull();
	expect(pickModel("default")).toBeNull();
});

test("completeOnce throws 'no-model' when nothing is authenticated", async () => {
	stubAvailable([]);
	await expect(completeOnce({ prompt: "hi" })).rejects.toThrow("no-model");
});

test("completeOnce dispatches a single request on the picked model and returns its text", async () => {
	// Register a faux under the top allowlist slot (anthropic/claude-haiku) so `pickModel("cheap")` lands
	// on it deterministically — even if the dev machine has other providers authed via env.
	const faux = createFauxCore({
		provider: "anthropic",
		api: "faux-anthropic",
		models: [modelDef("claude-haiku-faux")],
		tokensPerSecond: 5000,
	});
	const authStorage = AuthStorage.inMemory();
	const modelRegistry = ModelRegistry.inMemory(authStorage);
	// biome-ignore lint/suspicious/noExplicitAny: faux stream/model types bridge pi-ai ↔ pi-coding-agent
	(modelRegistry as any).registerProvider("anthropic", {
		api: "faux-anthropic",
		baseUrl: "http://faux.local",
		apiKey: "faux",
		streamSimple: faux.streamSimple,
		models: [{ ...modelDef("claude-haiku-faux"), api: "faux-anthropic" }],
	});
	configurePiRuntime({ authStorage, modelRegistry });
	faux.setResponses([fauxAssistantMessage("add-login-flow")]);

	const result = await completeOnce({
		system: "name it",
		prompt: "add a login flow",
		maxTokens: 24,
	});
	expect(result.text).toBe("add-login-flow");
	expect(result.model).toEqual({ provider: "anthropic", id: "claude-haiku-faux" });
});
