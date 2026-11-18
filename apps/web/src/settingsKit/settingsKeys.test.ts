import { describe, expect, test } from "bun:test";
import { localKeys } from "@thinkrail/ui/local-keys";
import { LOCAL_KEY_DEFAULTS } from "../keybindings";
import {
	escapeStep,
	navAction,
	navIndex,
	type SettingsPress,
	type WalkContext,
	walkAction,
	walkKey,
} from "./settingsKeys";

const press = (key: string, init: Partial<SettingsPress> = {}): SettingsPress => ({
	key,
	altKey: false,
	ctrlKey: false,
	metaKey: false,
	shiftKey: false,
	isComposing: false,
	keyCode: 0,
	...init,
});

const content = localKeys(null, "settings", LOCAL_KEY_DEFAULTS.settings);
const nav = localKeys(null, "settings.nav", LOCAL_KEY_DEFAULTS["settings.nav"]);

const event = (code: string, key: string, textEntry = false, init: Partial<SettingsPress> = {}) => {
	const pressed = { ...press(key, init), code, target: null };
	return { pressed, local: content.match(pressed, { textEntry }) };
};

const ON_ROW: WalkContext = { textEntry: false, multiline: false, onSide: false };
const ON_SIDE: WalkContext = { ...ON_ROW, onSide: true };
const IN_FIELD: WalkContext = { textEntry: true, multiline: false, onSide: false };
const IN_TEXTAREA: WalkContext = { textEntry: true, multiline: true, onSide: false };

describe("walkKey", () => {
	test("reads the arrows, Home/End and Esc, unmodified only", () => {
		expect(walkKey(press("ArrowDown"), null)).toBe("down");
		expect(walkKey(press("ArrowUp"), null)).toBe("up");
		expect(walkKey(press("ArrowLeft"), null)).toBe("left");
		expect(walkKey(press("ArrowRight"), null)).toBe("right");
		expect(walkKey(press("Home"), null)).toBe("home");
		expect(walkKey(press("End"), null)).toBe("end");
		expect(walkKey(press("Escape"), null)).toBe("escape");
		expect(walkKey(press("ArrowDown", { shiftKey: true }), null)).toBeNull();
		expect(walkKey(press("ArrowDown", { altKey: true }), null)).toBeNull();
		expect(walkKey(press("Enter"), null)).toBeNull();
		expect(walkKey(press("f"), null)).toBeNull();
	});

	test("takes the hjkl twins and Delete through the rebindable local keys", () => {
		const twin = event("KeyJ", "j");
		expect(walkKey(twin.pressed, twin.local)).toBe("down");
		const left = event("KeyH", "h");
		expect(walkKey(left.pressed, left.local)).toBe("left");
		const del = event("Delete", "Delete");
		expect(walkKey(del.pressed, del.local)).toBe("reset");
		const hint = event("KeyF", "f");
		expect([hint.local, walkKey(hint.pressed, hint.local)]).toEqual([null, null]);
	});

	test("a field keeps its letters and its Delete", () => {
		const twin = event("KeyJ", "j", true);
		expect(walkKey(twin.pressed, twin.local)).toBeNull();
		const del = event("Delete", "Delete", true);
		expect(walkKey(del.pressed, del.local)).toBeNull();
		const arrow = event("ArrowDown", "ArrowDown", true);
		expect(walkKey(arrow.pressed, arrow.local)).toBe("down");
	});

	test("an open IME composition is a no-op", () => {
		expect(walkKey(press("ArrowDown", { isComposing: true }), null)).toBeNull();
		expect(walkKey(press("Escape", { keyCode: 229 }), null)).toBeNull();
		expect(walkKey(press("Delete", { isComposing: true }), "settings.reset")).toBeNull();
	});
});

describe("walkAction", () => {
	test("↑/↓ move between rows, from a single-line field too, never from a multi-line one", () => {
		expect(walkAction("down", ON_ROW)).toEqual({ kind: "row", delta: 1 });
		expect(walkAction("up", ON_SIDE)).toEqual({ kind: "row", delta: -1 });
		expect(walkAction("down", IN_FIELD)).toEqual({ kind: "row", delta: 1 });
		expect(walkAction("up", IN_TEXTAREA)).toBeNull();
	});

	test("Home/End go to the first and last row outside text entry", () => {
		expect(walkAction("home", ON_ROW)).toEqual({ kind: "edge", edge: "first" });
		expect(walkAction("end", ON_SIDE)).toEqual({ kind: "edge", edge: "last" });
		expect(walkAction("home", IN_FIELD)).toBeNull();
	});

	test("→ goes to the sides, ← back along them, else to the nav; a field keeps both for its caret", () => {
		expect(walkAction("right", ON_ROW)).toEqual({ kind: "side", delta: 1 });
		expect(walkAction("right", ON_SIDE)).toEqual({ kind: "side", delta: 1 });
		expect(walkAction("left", ON_SIDE)).toEqual({ kind: "side", delta: -1 });
		expect(walkAction("left", ON_ROW)).toEqual({ kind: "nav" });
		expect(walkAction("left", IN_FIELD)).toBeNull();
		expect(walkAction("right", IN_TEXTAREA)).toBeNull();
	});

	test("Delete resets and Esc steps out wherever they reach the walk", () => {
		expect(walkAction("reset", ON_ROW)).toEqual({ kind: "reset" });
		expect(walkAction("escape", IN_FIELD)).toEqual({ kind: "escape" });
		expect(walkAction(null, ON_ROW)).toBeNull();
	});
});

describe("navAction", () => {
	const keyed = (code: string, key: string, init: Partial<SettingsPress> = {}) => {
		const pressed = { ...press(key, init), code, target: null };
		return navAction(pressed, nav.match(pressed));
	};

	test("↑/↓, the twins and Home/End select a section", () => {
		expect(keyed("ArrowDown", "ArrowDown")).toEqual({ kind: "select", delta: 1 });
		expect(keyed("KeyK", "k")).toEqual({ kind: "select", delta: -1 });
		expect(keyed("Home", "Home")).toEqual({ kind: "edge", edge: "first" });
		expect(keyed("End", "End")).toEqual({ kind: "edge", edge: "last" });
	});

	test("→, l, Enter and Space go into the section; ← stays", () => {
		expect(keyed("ArrowRight", "ArrowRight")).toEqual({ kind: "enter" });
		expect(keyed("KeyL", "l")).toEqual({ kind: "enter" });
		expect(keyed("Enter", "Enter")).toEqual({ kind: "enter" });
		expect(keyed("Space", " ")).toEqual({ kind: "enter" });
		expect(keyed("ArrowLeft", "ArrowLeft")).toEqual({ kind: "stay" });
		expect(keyed("KeyH", "h")).toEqual({ kind: "stay" });
	});

	test("S and / start the search; F and every other letter are left alone", () => {
		expect(keyed("KeyS", "s")).toEqual({ kind: "search" });
		expect(keyed("Slash", "/")).toEqual({ kind: "search" });
		expect(keyed("KeyF", "f")).toBeNull();
		expect(keyed("KeyA", "a")).toBeNull();
		expect(keyed("KeyS", "s", { ctrlKey: true })).toBeNull();
		expect(keyed("Escape", "Escape")).toBeNull();
		expect(keyed("ArrowDown", "ArrowDown", { isComposing: true })).toBeNull();
	});

	test("navIndex clamps instead of wrapping", () => {
		expect(navIndex({ kind: "select", delta: 1 }, 2, 5)).toBe(3);
		expect(navIndex({ kind: "select", delta: 1 }, 4, 5)).toBe(4);
		expect(navIndex({ kind: "select", delta: -1 }, 0, 5)).toBe(0);
		expect(navIndex({ kind: "edge", edge: "last" }, 0, 5)).toBe(4);
		expect(navIndex({ kind: "edge", edge: "first" }, 3, 5)).toBe(0);
		expect(navIndex({ kind: "enter" }, 3, 5)).toBeNull();
		expect(navIndex({ kind: "select", delta: 1 }, 0, 0)).toBeNull();
	});
});

test("escapeStep: content → results after a jump, else nav; results clear; search clears, then nav; nav closes", () => {
	const step = (
		place: Parameters<typeof escapeStep>[0]["place"],
		jumped: boolean,
		query: boolean,
	) => escapeStep({ place, jumped, query });
	expect(step("content", true, true)).toBe("results");
	expect(step("content", true, false)).toBe("nav");
	expect(step("content", false, true)).toBe("nav");
	expect(step("results", false, true)).toBe("clear");
	expect(step("search", false, true)).toBe("clear");
	expect(step("search", false, false)).toBe("nav");
	expect(step("nav", true, true)).toBe("close");
});
