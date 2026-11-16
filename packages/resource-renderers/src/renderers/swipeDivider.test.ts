import { expect, test } from "bun:test";
import { ARROW_TWIN_COMMANDS } from "@thinkrail/ui/keyboard";
import { localKeys } from "@thinkrail/ui/local-keys";
import { type CursorKeyEvent, REVIEW_SURFACE_SCOPE } from "../support/cursorKeys";
import { SWIPE_PAGE, SWIPE_STEP, swipeDividerValue } from "./swipeDivider";

const keys = localKeys(null, REVIEW_SURFACE_SCOPE, ARROW_TWIN_COMMANDS);

const key = (
	value: string,
	modifiers: { shiftKey?: boolean; ctrlKey?: boolean } = {},
): CursorKeyEvent => ({
	key: value,
	code: /^[hjkl]$/i.test(value) ? `Key${value.toUpperCase()}` : value,
	altKey: false,
	ctrlKey: false,
	metaKey: false,
	shiftKey: false,
	isComposing: false,
	keyCode: 0,
	target: null,
	...modifiers,
});

const value = (from: number, event: CursorKeyEvent) => swipeDividerValue(from, event, keys);

test("the swipe divider steps like a slider and stays within 0–100", () => {
	expect(value(50, key("ArrowRight"))).toBe(50 + SWIPE_STEP);
	expect(value(50, key("l"))).toBe(50 + SWIPE_STEP);
	expect(value(50, key("ArrowLeft"))).toBe(50 - SWIPE_STEP);
	expect(value(50, key("h"))).toBe(50 - SWIPE_STEP);
	expect(value(50, key("ArrowRight", { shiftKey: true }))).toBe(50 + SWIPE_PAGE);
	expect(value(50, key("H", { shiftKey: true }))).toBe(50 - SWIPE_PAGE);
	expect(value(50, key("PageUp"))).toBe(50 + SWIPE_PAGE);
	expect(value(50, key("PageDown"))).toBe(50 - SWIPE_PAGE);
	expect(value(50, key("Home"))).toBe(0);
	expect(value(50, key("End"))).toBe(100);
	expect(value(99, key("ArrowRight"))).toBe(100);
	expect(value(5, key("PageDown"))).toBe(0);
});

test("keys the slider does not own pass through", () => {
	expect(value(50, key("j"))).toBeNull();
	expect(value(50, key("Tab"))).toBeNull();
	expect(value(50, key("ArrowRight", { ctrlKey: true }))).toBeNull();
	expect(value(50, key("l", { ctrlKey: true }))).toBeNull();
	expect(value(50, { ...key("ArrowRight"), isComposing: true })).toBeNull();
});

test("a rebound twin moves the divider and its old letter passes through", () => {
	const rebound = localKeys(
		{
			platform: "Linux x86_64",
			scopes: new Map([
				[REVIEW_SURFACE_SCOPE, [{ id: "arrows.right", chord: { code: "KeyD", key: "D" } }]],
			]),
			isTextEntry: () => false,
		},
		REVIEW_SURFACE_SCOPE,
		ARROW_TWIN_COMMANDS,
	);
	expect(swipeDividerValue(50, { ...key("d"), code: "KeyD" }, rebound)).toBe(50 + SWIPE_STEP);
	expect(swipeDividerValue(50, key("l"), rebound)).toBeNull();
	expect(swipeDividerValue(50, key("h"), rebound)).toBeNull();
});
