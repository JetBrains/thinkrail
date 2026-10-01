import { expect, test } from "bun:test";
import type { AppConfig, ThinkingLevel, WireModel } from "@thinkrail/contracts";
import { DEFAULT_CONFIG } from "@thinkrail/contracts";
import { resolveNewChatModel } from "./newChatModel";

function wireModel(provider: string, id: string): WireModel {
	return {
		provider,
		id,
		name: id,
		contextWindow: 1_000,
		reasoning: true,
		thinkingLevels: ["off", "low", "medium"],
	};
}

function resolver(config: Partial<AppConfig>, models: WireModel[]) {
	const clampCalls: Array<{ provider: string; id: string; level: ThinkingLevel }> = [];
	return {
		clampCalls,
		resolve: (requested: { model?: WireModel; thinkingLevel?: ThinkingLevel } = {}) =>
			resolveNewChatModel(requested, {
				getConfig: () => ({ ...DEFAULT_CONFIG, ...config }),
				listSettledModels: async () => models,
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
