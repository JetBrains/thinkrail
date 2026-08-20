import { afterEach, expect, test } from "bun:test";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { createFauxCore, fauxAssistantMessage } from "@earendil-works/pi-ai/providers/faux";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { completeOnce, pickModel } from "./oneshot";
import { configurePiRuntime } from "./piRuntime";

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

function stubAvailable(models: ReturnType<typeof withProvider>[]): void {
	configurePiRuntime({ getAvailableSnapshot: () => models } as unknown as ModelRuntime);
}

function withProvider(provider: string, id: string, cost = 0) {
	return { ...modelDef(id, cost), api: `faux-${provider}`, provider, baseUrl: "http://faux.local" };
}

afterEach(() => {
	configurePiRuntime(null);
});

test("pickModel(cheap) prefers a known small model (allowlist) over a cheaper unlisted one", async () => {
	stubAvailable([
		withProvider("anthropic", "claude-haiku-faux", 10),
		withProvider("cheapo", "cheapo-1", 1),
	]);
	expect((await pickModel("cheap"))?.id).toBe("claude-haiku-faux");
});

test("pickModel(cheap) falls back to the cheapest by token cost when nothing is allowlisted", async () => {
	stubAvailable([withProvider("pricey", "pricey-1", 10), withProvider("cheapo", "cheapo-1", 1)]);
	expect((await pickModel("cheap"))?.id).toBe("cheapo-1");
});

test("pickModel(default) returns the first available model; empty set → null", async () => {
	stubAvailable([withProvider("pricey", "pricey-1", 10), withProvider("cheapo", "cheapo-1", 1)]);
	expect((await pickModel("default"))?.id).toBe("pricey-1");
	stubAvailable([]);
	expect(await pickModel("cheap")).toBeNull();
	expect(await pickModel("default")).toBeNull();
});

test("completeOnce throws 'no-model' when nothing is authenticated", async () => {
	stubAvailable([]);
	await expect(completeOnce({ prompt: "hi" })).rejects.toThrow("no-model");
});

test("completeOnce dispatches a single request on the picked model and returns its text", async () => {
	const faux = createFauxCore({
		provider: "anthropic",
		api: "faux-anthropic",
		models: [modelDef("claude-haiku-faux")],
		tokensPerSecond: 5000,
	});
	const runtime = await ModelRuntime.create({
		credentials: new InMemoryCredentialStore(),
		modelsPath: null,
		allowModelNetwork: false,
	});
	runtime.registerProvider("anthropic", {
		api: "faux-anthropic",
		baseUrl: "http://faux.local",
		apiKey: "faux",
		streamSimple: faux.streamSimple,
		models: [{ ...modelDef("claude-haiku-faux"), api: "faux-anthropic" }],
	});
	configurePiRuntime(runtime);
	faux.setResponses([fauxAssistantMessage("add-login-flow")]);

	const result = await completeOnce({
		system: "name it",
		prompt: "add a login flow",
		maxTokens: 24,
	});
	expect(result.text).toBe("add-login-flow");
	expect(result.model).toEqual({ provider: "anthropic", id: "claude-haiku-faux" });
});
