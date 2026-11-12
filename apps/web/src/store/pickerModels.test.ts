import { afterEach, describe, expect, test } from "bun:test";
import type { WireModel } from "@thinkrail/contracts";
import { useAppStore } from "./appStore";
import { selectPickerModels } from "./selectors";

function model(provider: string, id: string): WireModel {
	return { provider, id, name: id, contextWindow: 128_000, reasoning: false, thinkingLevels: [] };
}

const a = model("anthropic", "opus");
const b = model("openai", "gpt");
const c = model("openai", "o3");
const catalog = [a, b, c];

describe("selectPickerModels", () => {
	test("returns the catalog in order when nothing is hidden", () => {
		expect(selectPickerModels(catalog, [], [])).toEqual(catalog);
	});

	test("drops hidden models", () => {
		expect(selectPickerModels(catalog, [{ provider: "openai", id: "gpt" }], [])).toEqual([a, c]);
	});

	test("keeps a hidden model that is the current selection, in catalog order", () => {
		expect(
			selectPickerModels(
				catalog,
				[
					{ provider: "anthropic", id: "opus" },
					{ provider: "openai", id: "gpt" },
				],
				[null, { provider: "openai", id: "gpt" }],
			),
		).toEqual([b, c]);
	});

	test("never adds a kept model the catalog does not have", () => {
		expect(selectPickerModels(catalog, [], [{ provider: "x", id: "gone" }])).toEqual(catalog);
	});

	test("matches on provider and id together", () => {
		expect(selectPickerModels(catalog, [{ provider: "anthropic", id: "gpt" }], [])).toEqual(
			catalog,
		);
	});
});

describe("hidden model actions", () => {
	afterEach(() => useAppStore.getState().hydrateHiddenModels([]));

	test("setModelVisibility hides once and shows again", () => {
		const store = useAppStore.getState();
		store.setModelVisibility(b, false);
		store.setModelVisibility(b, false);
		expect(useAppStore.getState().hiddenModels).toEqual([{ provider: "openai", id: "gpt" }]);
		useAppStore.getState().setModelVisibility(b, true);
		expect(useAppStore.getState().hiddenModels).toEqual([]);
	});

	test("a no-op visibility change keeps the same array", () => {
		useAppStore.getState().setModelVisibility(b, false);
		const before = useAppStore.getState().hiddenModels;
		useAppStore.getState().setModelVisibility(b, false);
		useAppStore.getState().setModelVisibility(c, true);
		expect(useAppStore.getState().hiddenModels).toBe(before);
	});

	test("toggleModelVisibility flips one model", () => {
		useAppStore.getState().toggleModelVisibility(a);
		expect(useAppStore.getState().hiddenModels).toEqual([{ provider: "anthropic", id: "opus" }]);
		useAppStore.getState().toggleModelVisibility(a);
		expect(useAppStore.getState().hiddenModels).toEqual([]);
	});

	test("hydrateHiddenModels replaces the list", () => {
		useAppStore.getState().hydrateHiddenModels([{ provider: "openai", id: "o3" }]);
		expect(useAppStore.getState().hiddenModels).toEqual([{ provider: "openai", id: "o3" }]);
	});
});
