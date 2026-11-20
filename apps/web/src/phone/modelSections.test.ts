import { expect, test } from "bun:test";
import type { WireModel } from "@thinkrail/contracts";
import { t } from "@thinkrail/locales/react";
import { modelSections } from "./modelSections";

const model = (provider: string, id: string, name = id): WireModel =>
	({ provider, id, name, contextWindow: 200_000, thinkingLevels: ["off", "high"] }) as WireModel;

const fable = model("anthropic", "claude-fable-5-1", "Fable 5.1");
const opus = model("anthropic", "claude-opus-5-5", "Opus 5.5");
const gpt = model("openai", "gpt-6", "GPT-6");
const all = [fable, opus, gpt];

const shown = (sections: ReturnType<typeof modelSections>) =>
	sections.map((section) => [section.provider, section.models.map((entry) => entry.id)]);

test("groups by provider in the host's order, newest first within a provider, as the IDE picker does", () => {
	expect(shown(modelSections(t, all, null, ""))).toEqual([
		["anthropic", ["claude-opus-5-5", "claude-fable-5-1"]],
		["openai", ["gpt-6"]],
	]);
});

test("puts the current model's provider first so the selection is on screen", () => {
	expect(modelSections(t, all, gpt, "").map((section) => section.provider)).toEqual([
		"openai",
		"anthropic",
	]);
});

test("narrows by the IDE picker's search over name, id, provider and effort", () => {
	expect(shown(modelSections(t, all, null, " opus "))).toEqual([
		["anthropic", ["claude-opus-5-5"]],
	]);
	expect(shown(modelSections(t, all, null, "GPT-6"))).toEqual([["openai", ["gpt-6"]]]);
	expect(shown(modelSections(t, all, null, "fable"))).toEqual([
		["anthropic", ["claude-fable-5-1"]],
	]);
	expect(modelSections(t, all, null, "zzz")).toEqual([]);
});
