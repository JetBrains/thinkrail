import { describe, expect, test } from "bun:test";
import { DEFAULT_CONFIG, SETTLE_IDLE_DAYS } from "@thinkrail/contracts";
import {
	CLEARABLE_CONFIG_KEYS,
	configResetPatch,
	isClientPreferenceDefault,
	isConfigDefault,
	THEME_RESET_PATCH,
} from "./settingDefaults";

describe("config defaults", () => {
	test("a value setting is at its default when it equals DEFAULT_CONFIG and resets to it", () => {
		expect(isConfigDefault("chatLineWidth", DEFAULT_CONFIG.chatLineWidth)).toBe(true);
		expect(isConfigDefault("chatLineWidth", DEFAULT_CONFIG.chatLineWidth + 10)).toBe(false);
		expect(configResetPatch("chatLineWidth")).toEqual({
			chatLineWidth: DEFAULT_CONFIG.chatLineWidth,
		});
		expect(isConfigDefault("composerGrowthLimit", "compact")).toBe(false);
		expect(configResetPatch("voiceInputEnabled")).toEqual({ voiceInputEnabled: true });
	});

	test("structured values compare by content", () => {
		expect(isConfigDefault("interfaceFont", { family: null, fallbacks: [] })).toBe(true);
		expect(isConfigDefault("codeFont", { fallbacks: [], family: null })).toBe(true);
		expect(isConfigDefault("codeFont", { family: { name: "Fira Code" }, fallbacks: [] })).toBe(
			false,
		);
		expect(isConfigDefault("codeFont", { family: null, fallbacks: [{ name: "Symbols" }] })).toBe(
			false,
		);
		expect(configResetPatch("codeFont")).toEqual({ codeFont: { family: null, fallbacks: [] } });
	});

	test("the four optional model fields are default while unset and reset with null", () => {
		for (const key of CLEARABLE_CONFIG_KEYS) {
			expect(isConfigDefault(key, undefined)).toBe(true);
			expect(configResetPatch(key)).toEqual({ [key]: null });
		}
		expect(isConfigDefault("defaultEffort", "high")).toBe(false);
		expect(isConfigDefault("reviewEffort", "low")).toBe(false);
	});

	test("the settle period resets to 7 days, never to null, which means Never", () => {
		expect(SETTLE_IDLE_DAYS.default).toBe(7);
		expect(configResetPatch("settleIdleDays")).toEqual({ settleIdleDays: 7 });
		expect(isConfigDefault("settleIdleDays", 7)).toBe(true);
		expect(isConfigDefault("settleIdleDays", null)).toBe(false);
	});

	test("the theme resets as the fixed/dark pair", () => {
		expect(THEME_RESET_PATCH).toEqual({ themeMode: "fixed", theme: "dark" });
	});
});

test("client preferences compare with their owners' defaults", () => {
	expect(isClientPreferenceDefault("artifactsSmart", true)).toBe(true);
	expect(isClientPreferenceDefault("doubleShiftSearch", false)).toBe(false);
	expect(isClientPreferenceDefault("markdownOutlineSide", "right")).toBe(true);
	expect(isClientPreferenceDefault("chatMessageOrder", "newest-first")).toBe(false);
});
