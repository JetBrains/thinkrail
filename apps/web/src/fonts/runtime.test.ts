import { describe, expect, test } from "bun:test";
import type { StablePreferenceAdapter } from "../clientPreferences";
import {
	DEFAULT_FONT_PREFERENCES,
	FONT_PREFERENCES_KEY,
	fontFamilyStack,
	getFontPreferences,
	initializeFontPreferences,
	loadFontPreferences,
	normalizeFontName,
	parseFontPreferences,
	saveFontPreferences,
	subscribeFontPreferences,
	updateFontPreference,
} from "./runtime";

function memoryStorage(): StablePreferenceAdapter {
	const values = new Map<string, string>();
	return {
		getItem: (key) => values.get(key) ?? null,
		setItem: (key, value) => {
			values.set(key, value);
		},
		removeItem: (key) => {
			values.delete(key);
		},
	};
}

describe("font names", () => {
	test("accepts a single installed family, including CJK and Nerd Fonts", () => {
		expect(normalizeFontName("  更纱黑体 UI SC  ")).toBe("更纱黑体 UI SC");
		expect(normalizeFontName("MesloLGS NF")).toBe("MesloLGS NF");
		expect(normalizeFontName("  ")).toBe("");
		for (const value of [null, 7, "a,b", "a\nb", "a\u0000b", "a".repeat(201)]) {
			expect(normalizeFontName(value)).toBeNull();
		}
	});
	test("quotes the selection as a literal family and retains fallback", () => {
		expect(fontFamilyStack('A"B\\C', "monospace")).toBe('"A\\"B\\\\C", monospace');
		expect(fontFamilyStack("serif", "monospace")).toBe('"serif", monospace');
		expect(fontFamilyStack("", "monospace")).toBe("monospace");
	});
});

describe("client-local persistence", () => {
	test("normalizes valid fields independently and ignores unsupported versions", () => {
		expect(
			parseFontPreferences(
				JSON.stringify({
					version: 1,
					interface: " PingFang SC ",
					code: 2,
					terminal: "MesloLGS NF",
				}),
			),
		).toEqual({ interface: "PingFang SC", code: "", terminal: "MesloLGS NF" });
		for (const raw of [null, "oops", "null", "[]", '{"version":2,"code":"Fira Code"}']) {
			expect(parseFontPreferences(raw)).toEqual(DEFAULT_FONT_PREFERENCES);
		}
	});
	test("round trips all three selections and resets without server state", () => {
		const storage = memoryStorage();
		const selected = { interface: "PingFang SC", code: "Fira Code", terminal: "MesloLGS NF" };
		expect(saveFontPreferences(storage, selected)).toBe(true);
		expect(loadFontPreferences(storage)).toEqual(selected);
		expect(saveFontPreferences(storage, DEFAULT_FONT_PREFERENCES)).toBe(true);
		expect(loadFontPreferences(storage)).toEqual(DEFAULT_FONT_PREFERENCES);
	});
	test("tolerates unavailable storage and reports write failure", () => {
		const broken = {
			getItem() {
				throw new Error("denied");
			},
			setItem() {
				throw new Error("full");
			},
			removeItem() {},
		};
		expect(loadFontPreferences(broken)).toEqual(DEFAULT_FONT_PREFERENCES);
		expect(saveFontPreferences(broken, DEFAULT_FONT_PREFERENCES)).toBe(false);
		expect(saveFontPreferences(null, DEFAULT_FONT_PREFERENCES)).toBe(false);
	});
});

test("restores before rendering, applies independent tokens, signals atomically and resets", () => {
	const keys = [
		"document",
		"getComputedStyle",
		"localStorage",
		"__THINKRAIL_STABLE_PREFERENCES__",
	] as const;
	const previous = keys.map((key) => Object.getOwnPropertyDescriptor(globalThis, key));
	const storage = memoryStorage();
	storage.setItem(
		FONT_PREFERENCES_KEY,
		JSON.stringify({ version: 1, interface: "Local UI", code: "", terminal: "" }),
	);
	const overrides = new Map<string, string>();
	const defaults: Record<string, string> = {
		"--tr-font-family-interface": "Default UI, sans-serif",
		"--tr-font-family-code": "Default Code, monospace",
		"--tr-font-family-terminal": "Default Code, monospace",
	};
	const root = {
		style: {
			setProperty: (key: string, value: string) => {
				overrides.set(key, value);
			},
			removeProperty: (key: string) => {
				overrides.delete(key);
			},
		},
		dataset: {} as Record<string, string>,
	};
	let notifications = 0;
	let stop = () => {};
	try {
		Object.defineProperty(globalThis, "document", {
			configurable: true,
			value: { documentElement: root },
		});
		Object.defineProperty(globalThis, "getComputedStyle", {
			configurable: true,
			value: () => ({
				getPropertyValue: (key: string) => overrides.get(key) ?? defaults[key] ?? "",
			}),
		});
		Object.defineProperty(globalThis, "localStorage", {
			configurable: true,
			get: () => {
				throw new Error("native must take precedence");
			},
		});
		Object.defineProperty(globalThis, "__THINKRAIL_STABLE_PREFERENCES__", {
			configurable: true,
			value: storage,
		});
		initializeFontPreferences();
		expect(getFontPreferences().interface).toBe("Local UI");
		expect(overrides.get("--tr-font-family-interface")).toBe('"Local UI", Default UI, sans-serif');
		stop = subscribeFontPreferences(() => {
			notifications += 1;
			expect(root.dataset.fonts).toBeDefined();
		});
		expect(updateFontPreference("code", "Fira Code")).toBe("saved");
		expect(overrides.get("--tr-font-family-code")).toBe('"Fira Code", Default Code, monospace');
		expect(overrides.has("--tr-font-family-terminal")).toBe(false);
		const signal = root.dataset.fonts;
		updateFontPreference("code", "Fira Code");
		expect(root.dataset.fonts).toBe(signal);
		expect(updateFontPreference("code", "a,b")).toBe("invalid");
		expect(getFontPreferences().code).toBe("Fira Code");
		updateFontPreference("terminal", "Terminal Font");
		expect(overrides.get("--tr-font-family-terminal")).toBe(
			'"Terminal Font", Default Code, monospace',
		);
		updateFontPreference("code", "");
		expect(overrides.has("--tr-font-family-code")).toBe(false);
		expect(getFontPreferences().terminal).toBe("Terminal Font");
		expect(notifications).toBe(3);
		Object.defineProperty(globalThis, "__THINKRAIL_STABLE_PREFERENCES__", {
			configurable: true,
			value: null,
		});
		expect(updateFontPreference("interface", "Session only")).toBe("temporary");
		expect(getFontPreferences().interface).toBe("Session only");
	} finally {
		stop();
		for (const [index, key] of keys.entries()) {
			const descriptor = previous[index];
			if (descriptor) Object.defineProperty(globalThis, key, descriptor);
			else Reflect.deleteProperty(globalThis, key);
		}
	}
});
