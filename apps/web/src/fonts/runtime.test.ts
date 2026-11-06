import { describe, expect, it } from "bun:test";
import { DEFAULT_CONFIG, normalizeFontSettings } from "@thinkrail/contracts";
import { scaledTokens } from "./runtime";
import { BASE_CODE_SIZE, DEFAULT_FONT_SCALE } from "./scale";

const PREFERENCE = normalizeFontSettings(DEFAULT_CONFIG);

describe("scaledTokens", () => {
	it("removes every override at the default scale and the default preference", () => {
		const tokens = scaledTokens(PREFERENCE, DEFAULT_FONT_SCALE);
		expect(Object.values(tokens).every((value) => value === null)).toBe(true);
	});

	it("scales the primitives, the code trio and the top bar", () => {
		const tokens = scaledTokens(PREFERENCE, 1.6);
		expect(tokens["--tr-font-size-s11"]).toBe("18px");
		expect(tokens["--tr-font-size-code"]).toBe(`${Math.round(BASE_CODE_SIZE * 1.6)}px`);
		expect(tokens["--tr-font-size-code-dense"]).toBe("19px");
		expect(tokens["--tr-code-row-height"]).toBe("25px");
		expect(tokens["--topbar-row-height"]).toBe("64px");
		expect(tokens["--topbar-caption-height"]).toBe("22px");
		expect(tokens["--topbar-value-height"]).toBe("32px");
	});

	it("keeps the reader's code size at the default scale", () => {
		const tokens = scaledTokens({ ...PREFERENCE, codeFontSize: 16 }, DEFAULT_FONT_SCALE);
		expect(tokens["--tr-font-size-code"]).toBe("16px");
		expect(tokens["--tr-font-size-code-dense"]).toBe("14px");
		expect(tokens["--tr-code-row-height"]).toBe("18px");
		expect(tokens["--tr-font-size-s11"]).toBeNull();
	});

	it("derives the row height from the code size the reader picked, scaled", () => {
		// 16 × 1.6 = 26, dense 24, row round(24 × 1.3) = 31 — never 26 on a 14px row.
		const tokens = scaledTokens({ ...PREFERENCE, codeFontSize: 16 }, 1.6);
		expect(tokens["--tr-font-size-code"]).toBe("26px");
		expect(tokens["--tr-font-size-code-dense"]).toBe("24px");
		expect(tokens["--tr-code-row-height"]).toBe("31px");
	});

	it("takes the row height from the scaled size, not the unscaled one", () => {
		// The blocking finding's failure mode: 19px text on the 14px rows of the default preference.
		const tokens = scaledTokens(PREFERENCE, 1.6);
		const dense = Number.parseFloat(tokens["--tr-font-size-code-dense"] ?? "0");
		const row = Number.parseFloat(tokens["--tr-code-row-height"] ?? "0");
		expect(row).toBe(Math.round(dense * 1.3));
		expect(row).toBeGreaterThan(14);
	});
});
