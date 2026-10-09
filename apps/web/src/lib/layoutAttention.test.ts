import { describe, expect, test } from "bun:test";
import { type LayoutAttention, sameLayoutAttention } from "./layoutAttention";

const base: LayoutAttention = {
	selectedByGroup: { a: "tab-1", b: "tab-2" },
	lastFocusedCenterGroupId: "a",
	lastFocusedSideGroupId: { left: "b" },
	navigationClockByGroup: { a: 3 },
};

describe("sameLayoutAttention", () => {
	test("ignores key order and object identity", () => {
		expect(
			sameLayoutAttention(base, {
				...base,
				selectedByGroup: { b: "tab-2", a: "tab-1" },
				navigationClockByGroup: { a: 3 },
			}),
		).toBe(true);
	});

	test("detects every changed field", () => {
		expect(sameLayoutAttention(base, { ...base, lastFocusedCenterGroupId: "b" })).toBe(false);
		expect(sameLayoutAttention(base, { ...base, selectedByGroup: { a: "tab-1" } })).toBe(false);
		expect(sameLayoutAttention(base, { ...base, lastFocusedSideGroupId: {} })).toBe(false);
		expect(sameLayoutAttention(base, { ...base, navigationClockByGroup: { a: 4 } })).toBe(false);
		expect(sameLayoutAttention(base, undefined)).toBe(false);
	});
});
