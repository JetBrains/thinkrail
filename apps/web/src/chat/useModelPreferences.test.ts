import { describe, expect, test } from "bun:test";
import { sameModel, type ThinkingLevel, type WireModel } from "@thinkrail/contracts";
import { resolveAgainstCatalog } from "./useModelPreferences";

const model = (id: string, provider = "p", name = id): WireModel => ({
	id,
	name,
	provider,
	contextWindow: 1,
	reasoning: false,
	thinkingLevels: ["off"],
});

describe("resolveAgainstCatalog", () => {
	test("re-points stored snapshots to the live catalog objects, keeping the stored order", () => {
		const live = [model("b", "p", "B live"), model("a", "p", "A live")];
		const stored = [model("a", "p", "A stale"), model("b", "p", "B stale")];
		expect(resolveAgainstCatalog(live, stored)).toEqual([live[1], live[0]]);
	});

	test("drops snapshots whose provider/id left the catalog", () => {
		const live = [model("a")];
		expect(resolveAgainstCatalog(live, [model("a", "other"), model("gone"), model("a")])).toEqual([
			live[0],
		]);
	});
});

/**
 * Pure functions that mirror the hook's isDefaultModel/isDefault logic.
 * These test the comparison behavior without needing store/transport mocking.
 */
function isDefaultModel(
	defaultModelRef: Pick<WireModel, "provider" | "id"> | null,
	model: Pick<WireModel, "provider" | "id"> | null,
): boolean {
	return sameModel(defaultModelRef, model);
}

function isDefault(
	defaultModelRef: Pick<WireModel, "provider" | "id"> | null,
	defaultEffort: ThinkingLevel | undefined,
	model: Pick<WireModel, "provider" | "id"> | null,
	level: ThinkingLevel,
): boolean {
	return sameModel(defaultModelRef, model) && defaultEffort === level;
}

describe("default model comparison", () => {
	const claude = model("claude-sonnet", "anthropic");
	const gpt = model("gpt-4o", "openai");

	test("isDefaultModel matches same provider+id regardless of effort", () => {
		expect(isDefaultModel(claude, claude)).toBe(true);
		expect(isDefaultModel(claude, model("claude-sonnet", "anthropic"))).toBe(true);
		expect(isDefaultModel(claude, gpt)).toBe(false);
		expect(isDefaultModel(claude, null)).toBe(false);
		expect(isDefaultModel(null, claude)).toBe(false);
	});

	test("isDefault requires both model AND effort to match", () => {
		// Both match
		expect(isDefault(claude, "high", claude, "high")).toBe(true);
		// Same model, different effort
		expect(isDefault(claude, "high", claude, "medium")).toBe(false);
		expect(isDefault(claude, "high", claude, "low")).toBe(false);
		expect(isDefault(claude, "medium", claude, "high")).toBe(false);
		// Different model, same effort
		expect(isDefault(claude, "high", gpt, "high")).toBe(false);
		// Both different
		expect(isDefault(claude, "high", gpt, "medium")).toBe(false);
	});

	test("isDefault handles xhigh and max levels", () => {
		expect(isDefault(claude, "xhigh", claude, "xhigh")).toBe(true);
		expect(isDefault(claude, "max", claude, "max")).toBe(true);
		expect(isDefault(claude, "xhigh", claude, "max")).toBe(false);
		expect(isDefault(claude, "high", claude, "xhigh")).toBe(false);
	});

	test("isDefault handles off level", () => {
		expect(isDefault(claude, "off", claude, "off")).toBe(true);
		expect(isDefault(claude, "off", claude, "minimal")).toBe(false);
		expect(isDefault(claude, "minimal", claude, "off")).toBe(false);
	});

	test("isDefault handles undefined saved effort", () => {
		expect(isDefault(claude, undefined, claude, "high")).toBe(false);
		expect(isDefault(claude, undefined, claude, "off")).toBe(false);
	});
});

describe("Set as Default behavior", () => {
	const defaultModel = model("claude-sonnet", "anthropic");
	const defaultEffort: ThinkingLevel = "high";

	/**
	 * Simulates the button's disabled state logic from ModelEffortPicker.
	 * Disabled only when BOTH model and effort match the saved default.
	 */
	function shouldDisableSetDefault(
		rowModel: Pick<WireModel, "provider" | "id">,
		currentEffort: ThinkingLevel,
	): boolean {
		return isDefault(defaultModel, defaultEffort, rowModel, currentEffort);
	}

	test("disabled when both model and effort match", () => {
		expect(shouldDisableSetDefault(defaultModel, "high")).toBe(true);
	});

	test("enabled when same model but different effort", () => {
		// This is the key fix: can save new effort for existing default model
		expect(shouldDisableSetDefault(defaultModel, "medium")).toBe(false);
		expect(shouldDisableSetDefault(defaultModel, "low")).toBe(false);
		expect(shouldDisableSetDefault(defaultModel, "xhigh")).toBe(false);
		expect(shouldDisableSetDefault(defaultModel, "max")).toBe(false);
	});

	test("enabled when different model regardless of effort", () => {
		const otherModel = model("gpt-4o", "openai");
		expect(shouldDisableSetDefault(otherModel, "high")).toBe(false);
		expect(shouldDisableSetDefault(otherModel, "medium")).toBe(false);
	});

	test("model indicator separate from disabled state", () => {
		// The filled radio icon shows when the MODEL matches (regardless of effort)
		// But the button is only disabled when BOTH match

		// Same model, different effort: icon filled, button enabled
		const showFilledIcon = isDefaultModel(defaultModel, defaultModel);
		const buttonDisabled = shouldDisableSetDefault(defaultModel, "medium");
		expect(showFilledIcon).toBe(true);
		expect(buttonDisabled).toBe(false);

		// Different model: icon unfilled, button enabled
		const otherModel = model("gpt-4o", "openai");
		expect(isDefaultModel(defaultModel, otherModel)).toBe(false);
		expect(shouldDisableSetDefault(otherModel, "high")).toBe(false);
	});
});
