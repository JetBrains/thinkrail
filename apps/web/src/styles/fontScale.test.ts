import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import type { StablePreferenceAdapter } from "../clientPreferences";
import {
	applyFontScale,
	BASE_CODE_ROW_HEIGHT,
	BASE_TOPBAR_HEIGHTS,
	clampFontScale,
	currentFontScale,
	DEFAULT_FONT_SCALE,
	FONT_SCALE_MAX,
	FONT_SCALE_MIN,
	FONT_SCALE_STEP,
	fontScalePercent,
	fontScalePosition,
	readFontScale,
	scaledCodeRowHeight,
	scaledFontSize,
	subscribeFontScale,
	writeFontScale,
} from "./fontScale";

function stubRoot(): HTMLElement {
	const values = new Map<string, string>();
	return {
		style: {
			setProperty: (name: string, value: string) => void values.set(name, value),
			getPropertyValue: (name: string) => values.get(name) ?? "",
			removeProperty: (name: string) => void values.delete(name),
		},
		get values() {
			return values;
		},
	} as unknown as HTMLElement;
}

function stubStorage(): { values: Map<string, string>; adapter: StablePreferenceAdapter } {
	const values = new Map<string, string>();
	return {
		values,
		adapter: {
			getItem: (key) => values.get(key) ?? null,
			setItem: (key, value) => void values.set(key, value),
			removeItem: (key) => void values.delete(key),
		},
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

describe("clampFontScale", () => {
	it("keeps a scale inside the supported range", () => {
		expect(clampFontScale(1)).toBe(1);
		expect(clampFontScale(FONT_SCALE_MIN - 0.3)).toBe(FONT_SCALE_MIN);
		expect(clampFontScale(FONT_SCALE_MAX + 0.3)).toBe(FONT_SCALE_MAX);
	});

	it("snaps to the slider step", () => {
		expect(clampFontScale(1.23)).toBe(1.25);
		expect(clampFontScale(0.81)).toBe(0.8);
	});

	it("falls back to the default for junk", () => {
		expect(clampFontScale("big" as unknown as number)).toBe(DEFAULT_FONT_SCALE);
		expect(clampFontScale(null as unknown as number)).toBe(DEFAULT_FONT_SCALE);
	});

	it("clamps infinities to the nearest bound", () => {
		expect(clampFontScale(Number.POSITIVE_INFINITY)).toBe(FONT_SCALE_MAX);
		expect(clampFontScale(Number.NEGATIVE_INFINITY)).toBe(FONT_SCALE_MIN);
	});
});

describe("applyFontScale", () => {
	it("keeps the applied scale reachable for callers", () => {
		expect(applyFontScale(1.5, stubRoot())).toBe(1.5);
	});

	it("removes every override at the default scale", () => {
		const root = stubRoot();
		applyFontScale(1, root);
		expect(root.values.size).toBe(0);
	});

	it("scales every primitive and the code row height", () => {
		const root = stubRoot();
		applyFontScale(1.5, root);
		expect(root.values.size).toBe(14);
		expect(root.style.getPropertyValue("--tr-font-size-s14")).toBe(`${scaledFontSize(14, 1.5)}px`);
		expect(root.style.getPropertyValue("--tr-font-size-s44")).toBe(`${scaledFontSize(44, 1.5)}px`);
		expect(root.style.getPropertyValue("--tr-code-row-height")).toBe(
			`${scaledCodeRowHeight(1.5)}px`,
		);
	});

	it("grows the top bar's fixed rows with the text they hold", () => {
		const root = stubRoot();
		applyFontScale(1.6, root);
		expect(root.style.getPropertyValue("--topbar-row-height")).toBe("64px");
		expect(root.style.getPropertyValue("--topbar-caption-height")).toBe("22px");
		expect(root.style.getPropertyValue("--topbar-value-height")).toBe("32px");
	});

	it("scales the top bar from the bases tokens.css declares", () => {
		const tokens = readFileSync(new URL("./tokens.css", import.meta.url), "utf8");
		for (const [name, base] of Object.entries(BASE_TOPBAR_HEIGHTS))
			expect(tokens).toContain(`${name}: ${base}px;`);
	});

	it("shrinks as well as grows", () => {
		const root = stubRoot();
		applyFontScale(0.8, root);
		expect(root.style.getPropertyValue("--tr-font-size-s14")).toBe(`${scaledFontSize(14, 0.8)}px`);
		expect(root.style.getPropertyValue("--tr-code-row-height")).toBe(
			`${Math.round(BASE_CODE_ROW_HEIGHT * 0.8)}px`,
		);
	});
});

describe("fontScalePercent", () => {
	it("reads as a whole percentage", () => {
		expect(fontScalePercent(1.25)).toBe(125);
		expect(fontScalePercent(0.8)).toBe(80);
	});
});

describe("fontScalePosition", () => {
	it("measures the fill from the minimum, not from zero", () => {
		expect(fontScalePosition(FONT_SCALE_MIN)).toBe(0);
		expect(fontScalePosition(DEFAULT_FONT_SCALE)).toBe(25);
		expect(fontScalePosition(FONT_SCALE_MAX)).toBe(100);
	});

	it("clamps an out-of-range scale to the ends of the track", () => {
		expect(fontScalePosition(0)).toBe(0);
		expect(fontScalePosition(9)).toBe(100);
	});
});

describe("subscribeFontScale", () => {
	it("tells a subscriber when the reader moves the slider", () => {
		const storage = stubStorage();
		Reflect.set(globalThis, "__THINKRAIL_STABLE_PREFERENCES__", storage.adapter);
		let calls = 0;
		const stop = subscribeFontScale(() => {
			calls += 1;
		});
		writeFontScale(1.4);
		expect(calls).toBe(1);
		stop();
		writeFontScale(1.5);
		expect(calls).toBe(1);
	});
});

describe("currentFontScale", () => {
	it("keeps the chosen scale and still notifies when storage refuses it", () => {
		Reflect.set(globalThis, "__THINKRAIL_STABLE_PREFERENCES__", {
			getItem: () => null,
			setItem: () => {
				throw new Error("quota");
			},
			removeItem: () => {},
		} satisfies StablePreferenceAdapter);
		let calls = 0;
		const stop = subscribeFontScale(() => {
			calls += 1;
		});
		expect(writeFontScale(1.45)).toBe(1.45);
		stop();
		expect(calls).toBe(1);
		expect(currentFontScale()).toBe(1.45);
		expect(readFontScale()).toBe(DEFAULT_FONT_SCALE);
	});
});

describe("scaledFontSize", () => {
	it("rounds to whole pixels", () => {
		expect(scaledFontSize(13, 1.15)).toBe(15);
		expect(scaledFontSize(12, 0.85)).toBe(10);
	});
});

describe("readFontScale / writeFontScale", () => {
	it("round-trips through storage", () => {
		const storage = stubStorage();
		Reflect.set(globalThis, "__THINKRAIL_STABLE_PREFERENCES__", storage.adapter);
		expect(readFontScale()).toBe(DEFAULT_FONT_SCALE);
		expect(writeFontScale(1.3)).toBe(1.3);
		expect(storage.values.get("thinkrail-font-scale")).toBe(
			JSON.stringify({ version: 1, scale: 1.3 }),
		);
		expect(readFontScale()).toBe(1.3);
	});

	it("ignores a stored value of the wrong shape", () => {
		const storage = stubStorage();
		storage.values.set("thinkrail-font-scale", JSON.stringify({ version: 1, scale: "huge" }));
		Reflect.set(globalThis, "__THINKRAIL_STABLE_PREFERENCES__", storage.adapter);
		expect(readFontScale()).toBe(DEFAULT_FONT_SCALE);
	});

	it("ignores a stored value outside the range", () => {
		const storage = stubStorage();
		storage.values.set("thinkrail-font-scale", JSON.stringify({ version: 1, scale: 9 }));
		Reflect.set(globalThis, "__THINKRAIL_STABLE_PREFERENCES__", storage.adapter);
		expect(readFontScale()).toBe(FONT_SCALE_MAX);
	});

	it("snaps a stored value onto the step", () => {
		const storage = stubStorage();
		storage.values.set("thinkrail-font-scale", JSON.stringify({ version: 1, scale: 1.27 }));
		Reflect.set(globalThis, "__THINKRAIL_STABLE_PREFERENCES__", storage.adapter);
		expect(readFontScale()).toBe(1.25);
		expect(FONT_SCALE_STEP).toBeGreaterThan(0);
	});
});
