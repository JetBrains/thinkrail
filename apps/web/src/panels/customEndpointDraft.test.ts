import { expect, test } from "bun:test";
import type { CustomEndpointModel } from "@thinkrail/contracts";
import {
	addManualModel,
	addressMoved,
	applyPreset,
	canSave,
	draftParams,
	editEndpointDraft,
	LOCAL_SERVER_PRESETS,
	mergeProbe,
	newEndpointDraft,
	probeTarget,
} from "./customEndpointDraft";

function model(id: string, patch: Partial<CustomEndpointModel> = {}): CustomEndpointModel {
	return {
		id,
		contextWindow: null,
		maxTokens: null,
		reasoning: null,
		vision: null,
		tools: null,
		...patch,
	};
}

const saved = {
	id: "custom-gw",
	name: "Gateway",
	baseUrl: "https://gw.example/v1",
	hasApiKey: true,
	models: [model("a", { contextWindow: 8_000, maxTokens: 2_000 }), model("manual")],
};

test("a preset fills the local address and only replaces an empty or preset name", () => {
	const [ollama, lmStudio] = LOCAL_SERVER_PRESETS;
	const filled = applyPreset(newEndpointDraft(), ollama);
	expect(filled).toMatchObject({ name: "Ollama", baseUrl: "http://127.0.0.1:11434/v1" });
	expect(applyPreset(filled, lmStudio).name).toBe("LM Studio");
	expect(applyPreset({ ...filled, name: "My box" }, lmStudio).name).toBe("My box");
});

test("the first detection selects every model and later ones keep the user's choice", () => {
	const first = mergeProbe(newEndpointDraft(), {
		ok: true,
		baseUrl: "http://h/v1",
		models: [model("a"), model("b")],
	});
	expect(first.models.map((row) => row.selected)).toEqual([true, true]);
	const unselected = {
		...first,
		models: first.models.map((row) => ({ ...row, selected: row.id === "a" })),
	};
	const again = mergeProbe(unselected, {
		ok: true,
		baseUrl: "http://h/v1",
		models: [model("a"), model("b"), model("c")],
	});
	expect(again.models.map((row) => [row.id, row.selected])).toEqual([
		["a", true],
		["b", false],
		["c", false],
	]);
});

test("re-detecting keeps saved facts the server doesn't report and refreshes the ones it does", () => {
	const draft = editEndpointDraft(saved);
	const merged = mergeProbe(draft, {
		ok: true,
		baseUrl: "https://gw.example/v1",
		models: [model("a", { tools: true })],
	});
	expect(merged.models).toEqual([
		{ ...model("a", { contextWindow: 8_000, maxTokens: 2_000, tools: true }), selected: true },
		{ ...model("manual"), selected: true },
	]);
	const smaller = mergeProbe(draft, {
		ok: true,
		baseUrl: "https://gw.example/v1",
		models: [model("a", { contextWindow: 4_096 })],
	});
	expect(smaller.models[0]).toMatchObject({ contextWindow: 4_096, maxTokens: null });
});

test("an unchanged saved address stays as written while a typed one takes the probed form", () => {
	const draft = editEndpointDraft(saved);
	expect(
		mergeProbe(draft, { ok: true, baseUrl: "https://gw.example/v1", models: [] }).baseUrl,
	).toBe("https://gw.example/v1");
	const typed = { ...newEndpointDraft(), baseUrl: "http://127.0.0.1:11434" };
	expect(
		mergeProbe(typed, { ok: true, baseUrl: "http://127.0.0.1:11434/v1", models: [] }).baseUrl,
	).toBe("http://127.0.0.1:11434/v1");
});

test("Detect sends a typed key, else the saved endpoint, and never a key marked for removal", () => {
	const draft = editEndpointDraft(saved);
	expect(probeTarget(draft)).toEqual({ endpointId: "custom-gw" });
	expect(probeTarget({ ...draft, apiKey: "sk-new" })).toEqual({ apiKey: "sk-new" });
	expect(probeTarget({ ...draft, removeKey: true })).toEqual({});
	expect(probeTarget(newEndpointDraft())).toEqual({ apiKey: "" });
});

test("save sends selected models, keeps a saved key unless replaced or removed", () => {
	const draft = {
		...editEndpointDraft(saved),
		models: editEndpointDraft(saved).models.map((row) => ({ ...row, selected: row.id === "a" })),
	};
	expect(draftParams(draft)).toEqual({
		id: "custom-gw",
		name: "Gateway",
		baseUrl: "https://gw.example/v1",
		models: [model("a", { contextWindow: 8_000, maxTokens: 2_000 })],
	});
	expect(draftParams({ ...draft, apiKey: " sk-new " }).apiKey).toBe("sk-new");
	expect(draftParams({ ...draft, removeKey: true }).apiKey).toBe("");
	expect(draftParams(newEndpointDraft()).apiKey).toBe("");
});

test("manual ids are trimmed, deduplicated and selected; saving needs a name, address and a model", () => {
	let draft = addManualModel(newEndpointDraft(), "  qwen3-coder ");
	draft = addManualModel(draft, "qwen3-coder");
	expect(draft.models).toEqual([{ ...model("qwen3-coder"), selected: true }]);
	expect(canSave(draft)).toBe(false);
	expect(canSave({ ...draft, name: "GW", baseUrl: "https://gw.example/v1" })).toBe(true);
	expect(
		canSave({
			...draft,
			name: "GW",
			baseUrl: "https://gw.example/v1",
			models: draft.models.map((row) => ({ ...row, selected: false })),
		}),
	).toBe(false);
});

test("re-detecting keeps an unreported capability and clears one the server now denies", () => {
	const draft = editEndpointDraft({
		...saved,
		models: [model("a", { reasoning: true, vision: true })],
	});
	const unreported = mergeProbe(draft, {
		ok: true,
		baseUrl: "https://gw.example/v1",
		models: [model("a")],
	});
	expect(unreported.models[0]).toMatchObject({ reasoning: true, vision: true });
	const denied = mergeProbe(draft, {
		ok: true,
		baseUrl: "https://gw.example/v1",
		models: [model("a", { reasoning: false, vision: false })],
	});
	expect(denied.models[0]).toMatchObject({ reasoning: false, vision: false });
});

test("an edit can change the path but not the origin of a saved server", () => {
	const draft = editEndpointDraft(saved);
	expect(addressMoved({ ...draft, baseUrl: "https://gw.example/openai/v1" })).toBe(false);
	expect(addressMoved({ ...draft, baseUrl: "https://other.example/v1" })).toBe(true);
	expect(canSave({ ...draft, baseUrl: "https://other.example/v1" })).toBe(false);
	expect(addressMoved({ ...newEndpointDraft(), baseUrl: "https://other.example/v1" })).toBe(false);
});
