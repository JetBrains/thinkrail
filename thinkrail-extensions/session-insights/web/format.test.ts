import { describe, expect, test } from "bun:test";
import { currentTranslator } from "@thinkrail/locales/react";
import {
	formatCost,
	formatCostExact,
	formatCount,
	formatDuration,
	formatShare,
	formatStart,
	formatTokens,
} from "./format";

const EN = "en-US";

describe("number formats", () => {
	test("tokens read compact above a thousand", () => {
		expect(formatTokens(EN, 0)).toBe("0");
		expect(formatTokens(EN, 999)).toBe("999");
		expect(formatTokens(EN, 466_000)).toBe("466K");
		expect(formatTokens(EN, 8_200_000)).toBe("8.2M");
		expect(formatTokens(EN, 1_200_000_000)).toBe("1.2B");
		expect(formatCount(EN, 1_060)).toBe("1,060");
	});

	test("cost shows $0 bare, cents normally and sub-cent amounts with a third digit", () => {
		expect(formatCost(EN, 0)).toBe("$0");
		expect(formatCost(EN, 2.04)).toBe("$2.04");
		expect(formatCost(EN, 159.614)).toBe("$159.61");
		expect(formatCost(EN, 0.007)).toBe("$0.007");
		expect(formatCost(EN, 0.0004)).toBe("<$0.001");
		expect(formatCostExact(EN, 0.123456789)).toBe("$0.123457");
	});

	test("the error share is a whole percent and absent without calls", () => {
		expect(formatShare(EN, 1, 2)).toBe("50%");
		expect(formatShare(EN, 2, 70)).toBe("3%");
		expect(formatShare(EN, 0, 0)).toBeNull();
	});
});

describe("time formats", () => {
	const t = currentTranslator();

	test("durations shorten to the two largest units, exact ones keep seconds", () => {
		expect(formatDuration(t, 42_000)).toBe("42 s");
		expect(formatDuration(t, 12 * 60_000 + 20_000)).toBe("12 min");
		expect(formatDuration(t, 3 * 3_600_000 + 5 * 60_000)).toBe("3 h 5 min");
		expect(formatDuration(t, 3 * 3_600_000 + 5 * 60_000 + 7_000, true)).toBe("3 h 5 min 7 s");
		expect(formatDuration(t, 65_000, true)).toBe("1 min 5 s");
	});

	test("the start reads day and time within the current year, the date alone before it", () => {
		const start = Date.UTC(2026, 10, 15, 9, 30);
		const thisYear = formatStart(EN, start, Date.UTC(2026, 11, 1));
		expect(thisYear).not.toContain("2026");
		expect(thisYear).toMatch(/\d:\d\d/);
		const earlier = formatStart(EN, start, Date.UTC(2027, 0, 2));
		expect(earlier).toContain("2026");
		expect(earlier).not.toContain(":");
	});
});
