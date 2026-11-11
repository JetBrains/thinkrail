import { expect, test } from "bun:test";
import type { AppConfig, ThinkingLevel, WireModel } from "@thinkrail/contracts";
import { DEFAULT_CONFIG } from "@thinkrail/contracts";
import { resolveNewChatModel } from "./newChatModel";

function wireModel(provider: string, id: string, auth?: WireModel["auth"]): WireModel {
	return {
		provider,
		id,
		name: id,
		contextWindow: 1_000,
		reasoning: true,
		thinkingLevels: ["off", "low", "medium"],
		...(auth ? { auth } : {}),
	};
}

function resolver(
	config: Partial<AppConfig>,
	models: WireModel[],
	piDefault?: { provider: string; id: string },
) {
	const clampCalls: Array<{ provider: string; id: string; level: ThinkingLevel }> = [];
	return {
		clampCalls,
		resolve: (requested: { model?: WireModel; thinkingLevel?: ThinkingLevel } = {}) =>
			resolveNewChatModel(requested, {
				getConfig: () => ({ ...DEFAULT_CONFIG, ...config }),
				listSettledModels: async () => models,
				piDefaultModelRef: () => piDefault,
				clampThinkingForModel: async (model, level) => {
					clampCalls.push({ ...model, level });
					return model.provider === "limited" && level === "high" ? "medium" : level;
				},
			}),
	};
}

const first = wireModel("first", "one");
const second = wireModel("second", "two");

test("new-chat model resolution uses a saved available model and clamps its saved effort", async () => {
	const saved = wireModel("limited", "saved");
	const { resolve, clampCalls } = resolver({ defaultModel: saved, defaultEffort: "high" }, [
		first,
		saved,
	]);

	expect(await resolve()).toEqual({ model: saved, thinkingLevel: "medium" });
	expect(clampCalls).toEqual([{ provider: "limited", id: "saved", level: "high" }]);
});

test("new-chat model resolution falls back to the first model when the saved model is unavailable", async () => {
	const { resolve } = resolver(
		{ defaultModel: wireModel("missing", "gone"), defaultEffort: "low" },
		[first, second],
	);

	expect(await resolve()).toEqual({ model: first, thinkingLevel: "low" });
});

test("new-chat model resolution falls back to the first model when no default is saved", async () => {
	const { resolve } = resolver({}, [first, second]);

	expect(await resolve()).toEqual({ model: first, thinkingLevel: "medium" });
});

test("new-chat model resolution omits the model when the available catalog is empty", async () => {
	const { resolve } = resolver({ defaultEffort: "high" }, []);

	expect(await resolve()).toEqual({ model: null, thinkingLevel: "high" });
});

test("an explicit model and effort override saved defaults", async () => {
	const explicit = wireModel("explicit", "chosen");
	const { resolve } = resolver({ defaultModel: second, defaultEffort: "low" }, [
		first,
		second,
		explicit,
	]);

	expect(await resolve({ model: explicit, thinkingLevel: "high" })).toEqual({
		model: explicit,
		thinkingLevel: "high",
	});
});

test("a thinking-only request uses the resolved default model and clamps the requested effort", async () => {
	const saved = wireModel("limited", "saved");
	const { resolve, clampCalls } = resolver({ defaultModel: saved }, [first, saved]);

	expect(await resolve({ thinkingLevel: "high" })).toEqual({
		model: saved,
		thinkingLevel: "medium",
	});
	expect(clampCalls).toEqual([{ provider: "limited", id: "saved", level: "high" }]);
});

test("new-chat model resolution prefers pi's provider default over catalog order", async () => {
	const legacy = wireModel("openai", "gpt-4");
	const current = wireModel("openai", "gpt-6.1-sol");
	const { resolve } = resolver({}, [legacy, current]);

	expect(await resolve()).toEqual({ model: current, thinkingLevel: "medium" });
});

test("new-chat model resolution uses pi's configured default when no default is saved", async () => {
	const { resolve } = resolver({}, [first, second], { provider: "second", id: "two" });

	expect(await resolve()).toEqual({ model: second, thinkingLevel: "medium" });
});

test("a saved default wins over pi's configured default", async () => {
	const { resolve } = resolver({ defaultModel: first }, [first, second], {
		provider: "second",
		id: "two",
	});

	expect(await resolve()).toEqual({ model: first, thinkingLevel: "medium" });
});

test("an unavailable pi default falls through to the preferred model", async () => {
	const { resolve } = resolver({}, [first, second], { provider: "missing", id: "gone" });

	expect(await resolve()).toEqual({ model: first, thinkingLevel: "medium" });
});

const environmentModel = wireModel("openai", "gpt-6.1-sol", {
	kind: "env",
	detail: "OPENAI_API_KEY",
});
const subscriptionModel = wireModel("openai-codex", "gpt-6.1-sol", { kind: "oauth" });

test("an ambient OpenAI API key does not preempt the configured Codex subscription", async () => {
	const { resolve } = resolver({}, [environmentModel, subscriptionModel]);

	expect(await resolve()).toEqual({ model: subscriptionModel, thinkingLevel: "medium" });
});

test.each(["api-key", "central"] as const)(
	"a configured %s connection takes precedence over an environment connection",
	async (kind) => {
		const configured = wireModel("custom", "chosen", { kind });
		const { resolve } = resolver({}, [environmentModel, configured]);

		expect(await resolve()).toEqual({ model: configured, thinkingLevel: "medium" });
	},
);

test("an unavailable saved model falls back to the configured subscription", async () => {
	const { resolve } = resolver({ defaultModel: wireModel("missing", "gone") }, [
		environmentModel,
		subscriptionModel,
	]);

	expect(await resolve()).toEqual({ model: subscriptionModel, thinkingLevel: "medium" });
});

test("an available saved environment model still takes precedence over a subscription", async () => {
	const { resolve } = resolver({ defaultModel: environmentModel }, [
		environmentModel,
		subscriptionModel,
	]);

	expect(await resolve()).toEqual({ model: environmentModel, thinkingLevel: "medium" });
});

test("an explicitly requested environment model still takes precedence over a subscription", async () => {
	const { resolve } = resolver({ defaultModel: subscriptionModel }, [
		environmentModel,
		subscriptionModel,
	]);

	expect(await resolve({ model: environmentModel })).toEqual({
		model: environmentModel,
		thinkingLevel: "medium",
	});
});

test("pi's configured default environment model still takes precedence over a subscription", async () => {
	const { resolve } = resolver({}, [environmentModel, subscriptionModel], {
		provider: "openai",
		id: "gpt-6.1-sol",
	});

	expect(await resolve()).toEqual({ model: environmentModel, thinkingLevel: "medium" });
});

test("environment-only connections retain pi's model preference", async () => {
	const legacy = wireModel("openai", "gpt-4", { kind: "env" });
	const { resolve } = resolver({}, [legacy, environmentModel]);

	expect(await resolve()).toEqual({ model: environmentModel, thinkingLevel: "medium" });
});
