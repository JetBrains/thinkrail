import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { StablePreferenceAdapter } from "../clientPreferences";
import {
	BASE_CODE_FONT_SIZE,
	BASE_CODE_ROW_HEIGHT,
	BASE_CODE_SIZE,
	clampFontScale,
	codeRowHeight,
	codeSize,
	DEFAULT_FONT_SCALE,
	denseCodeSize,
	FONT_SCALE_MAX,
	FONT_SCALE_MIN,
	FONT_SCALE_STEP,
	fontScalePercent,
	readFontScale,
	scaledFontSize,
	writeFontScale,
} from "./scale";

function stubStorage(): StablePreferenceAdapter {
	const values = new Map<string, string>();
	return {
		getItem: (key) => values.get(key) ?? null,
		setItem: (key, value) => void values.set(key, value),
		removeItem: (key) => void values.delete(key),
	};
}

let installed: unknown;

beforeEach(() => {
	installed = Reflect.get(globalThis, "__THINKRAIL_STABLE_PREFERENCES__");
});

afterEach(() => {
	if (installed === undefined)
		Reflect.deleteProperty(globalThis, "__THINKRAIL_STABLE_PREFERENCES__");
	else Reflect.set(globalThis, "__THINKRAIL_STABLE_PREFERENCES__", installed);
});

function useStorage(adapter: StablePreferenceAdapter): void {
	Reflect.set(globalThis, "__THINKRAIL_STABLE_PREFERENCES__", adapter);
}

describe("clampFontScale", () => {
	it("keeps a scale inside the supported range", () => {
		expect(clampFontScale(1.2)).toBe(1.2);
		expect(clampFontScale(0.5)).toBe(FONT_SCALE_MIN);
		expect(clampFontScale(4)).toBe(FONT_SCALE_MAX);
	});

	it("snaps to the slider step", () => {
		expect(clampFontScale(1.13)).toBe(1.15);
		expect(clampFontScale(1.17)).toBe(1.15);
	});

	it("falls back to the default for junk", () => {
		expect(clampFontScale(Number.NaN)).toBe(DEFAULT_FONT_SCALE);
		expect(clampFontScale(Number.POSITIVE_INFINITY)).toBe(FONT_SCALE_MAX);
		expect(clampFontScale(Number.NEGATIVE_INFINITY)).toBe(FONT_SCALE_MIN);
	});
});

describe("scaledFontSize", () => {
	it("rounds to whole pixels", () => {
		expect(scaledFontSize(BASE_CODE_FONT_SIZE, 1.15)).toBe(13);
		expect(scaledFontSize(BASE_CODE_FONT_SIZE, 1.5)).toBe(17);
	});
});

describe("the code trio", () => {
	it("derives the dense size from the code size", () => {
		expect(codeSize(BASE_CODE_SIZE, 1)).toBe(BASE_CODE_SIZE);
		expect(denseCodeSize(BASE_CODE_SIZE, 1)).toBe(BASE_CODE_FONT_SIZE);
		expect(codeRowHeight(BASE_CODE_SIZE, 1)).toBe(BASE_CODE_ROW_HEIGHT);
	});

	it("keeps text and row geometry in step at 160%", () => {
		// 13 → 21, dense 19, row round(19 × 1.3) = 25.
		expect(codeSize(BASE_CODE_SIZE, 1.6)).toBe(21);
		expect(denseCodeSize(BASE_CODE_SIZE, 1.6)).toBe(19);
		expect(codeRowHeight(BASE_CODE_SIZE, 1.6)).toBe(25);
	});

	it("follows a code size the reader picked", () => {
		expect(codeSize(16, 1.6)).toBe(26);
		expect(denseCodeSize(16, 1.6)).toBe(24);
		expect(codeRowHeight(16, 1.6)).toBe(31);
	});
});

describe("fontScalePercent", () => {
	it("reads as a whole percentage", () => {
		expect(fontScalePercent(DEFAULT_FONT_SCALE)).toBe(100);
		expect(fontScalePercent(FONT_SCALE_MAX)).toBe(160);
		expect(fontScalePercent(FONT_SCALE_MIN)).toBe(80);
	});
});

describe("readFontScale / writeFontScale", () => {
	it("round-trips through storage", () => {
		useStorage(stubStorage());
		expect(writeFontScale(1.25)).toBe(1.25);
		expect(readFontScale()).toBe(1.25);
	});

	it("ignores a stored value of the wrong shape", () => {
		const adapter = stubStorage();
		useStorage(adapter);
		adapter.setItem("thinkrail-font-scale", JSON.stringify({ version: 9, scale: 1.4 }));
		expect(readFontScale()).toBe(DEFAULT_FONT_SCALE);
	});

	it("ignores a stored value outside the range", () => {
		const adapter = stubStorage();
		useStorage(adapter);
		adapter.setItem("thinkrail-font-scale", JSON.stringify({ version: 1, scale: 12 }));
		expect(readFontScale()).toBe(FONT_SCALE_MAX);
	});

	it("snaps a stored value onto the step", () => {
		const adapter = stubStorage();
		useStorage(adapter);
		adapter.setItem("thinkrail-font-scale", JSON.stringify({ version: 1, scale: 1.17 }));
		expect(readFontScale()).toBe(1.15);
		expect(FONT_SCALE_STEP).toBe(0.05);
	});
});
