import { expect, test } from "bun:test";
import type { WireModel } from "@thinkrail/contracts";
import { modelSections } from "./modelSections";

const model = (provider: string, id: string, name = id): WireModel =>
	({ provider, id, name, contextWindow: 200_000, thinkingLevels: ["off", "high"] }) as WireModel;

const opus = model("anthropic", "claude-opus-5-5", "Opus 5.5");
const fable = model("anthropic", "claude-fable-5-1", "Fable 5.1");
const gpt = model("openai", "gpt-6", "GPT-6");
const all = [opus, fable, gpt];

test("groups by provider in the host's order", () => {
	expect(modelSections(all, null, "")).toEqual([
		{ provider: "anthropic", models: [opus, fable] },
		{ provider: "openai", models: [gpt] },
	]);
});

test("puts the current model's provider first so the selection is on screen", () => {
	expect(modelSections(all, gpt, "").map((section) => section.provider)).toEqual([
		"openai",
		"anthropic",
	]);
});

test("filters by name, id or provider, ignoring case and spaces around the query", () => {
	expect(modelSections(all, null, " opus ")).toEqual([{ provider: "anthropic", models: [opus] }]);
	expect(modelSections(all, null, "GPT-6")).toEqual([{ provider: "openai", models: [gpt] }]);
	expect(modelSections(all, null, "openai")).toEqual([{ provider: "openai", models: [gpt] }]);
	expect(modelSections(all, null, "nothing")).toEqual([]);
});
