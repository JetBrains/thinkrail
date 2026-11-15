import { expect, test } from "bun:test";
import { SWIPE_PAGE, SWIPE_STEP, swipeDividerValue } from "./swipeDivider";

const key = (value: string, modifiers: { shiftKey?: boolean; ctrlKey?: boolean } = {}) => ({
	key: value,
	altKey: false,
	ctrlKey: false,
	metaKey: false,
	shiftKey: false,
	isComposing: false,
	keyCode: 0,
	...modifiers,
});

test("the swipe divider steps like a slider and stays within 0–100", () => {
	expect(swipeDividerValue(50, key("ArrowRight"))).toBe(50 + SWIPE_STEP);
	expect(swipeDividerValue(50, key("l"))).toBe(50 + SWIPE_STEP);
	expect(swipeDividerValue(50, key("ArrowLeft"))).toBe(50 - SWIPE_STEP);
	expect(swipeDividerValue(50, key("h"))).toBe(50 - SWIPE_STEP);
	expect(swipeDividerValue(50, key("ArrowRight", { shiftKey: true }))).toBe(50 + SWIPE_PAGE);
	expect(swipeDividerValue(50, key("H", { shiftKey: true }))).toBe(50 - SWIPE_PAGE);
	expect(swipeDividerValue(50, key("PageUp"))).toBe(50 + SWIPE_PAGE);
	expect(swipeDividerValue(50, key("PageDown"))).toBe(50 - SWIPE_PAGE);
	expect(swipeDividerValue(50, key("Home"))).toBe(0);
	expect(swipeDividerValue(50, key("End"))).toBe(100);
	expect(swipeDividerValue(99, key("ArrowRight"))).toBe(100);
	expect(swipeDividerValue(5, key("PageDown"))).toBe(0);
});

test("keys the slider does not own pass through", () => {
	expect(swipeDividerValue(50, key("j"))).toBeNull();
	expect(swipeDividerValue(50, key("Tab"))).toBeNull();
	expect(swipeDividerValue(50, key("ArrowRight", { ctrlKey: true }))).toBeNull();
	expect(swipeDividerValue(50, { ...key("ArrowRight"), isComposing: true })).toBeNull();
});
