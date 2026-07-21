import { expect, test } from "bun:test";
import { Theme } from "@thinkrail/contracts";
import { THEMES } from "./theme";

// Pins the picker source: the high-contrast id exists, carries its display label, and lists last
// (THEME_IDS is Theme-declaration order; the picker renders THEMES in order).
test("THEMES lists high-contrast last with its display label", () => {
	const hc = THEMES.find((t) => t.id === Theme.HighContrast);
	expect(hc?.label).toBe("High Contrast");
	expect(THEMES[THEMES.length - 1]?.id).toBe(Theme.HighContrast);
});
