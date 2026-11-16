import { expect, test } from "bun:test";
import { isKeybindingChord, isKeybindingOverrides, isModifierKeyCode } from "./index";

test("a chord is ordered modifiers then one KeyboardEvent.code", () => {
	for (const chord of [
		"Mod+Alt+KeyS",
		"Ctrl+Alt+ArrowLeft",
		"F6",
		"Shift+F6",
		"Mod+Semicolon",
		"Mod+Backslash",
		"Mod+Ctrl+Alt+Shift+Digit1",
		"KeyF",
		"NumpadAdd",
	]) {
		expect([chord, isKeybindingChord(chord)]).toEqual([chord, true]);
	}
});

test("modifiers out of order, repeated, unknown or lowercase are rejected", () => {
	for (const chord of [
		"Alt+Mod+KeyS",
		"Shift+Ctrl+KeyS",
		"Mod+Mod+KeyS",
		"Cmd+KeyS",
		"Meta+KeyS",
		"mod+KeyS",
		"+KeyS",
		"Mod++KeyS",
	]) {
		expect([chord, isKeybindingChord(chord)]).toEqual([chord, false]);
	}
});

test("the key must be a code, never a modifier key, a modifier name or a typed character", () => {
	for (const chord of [
		"",
		"Mod+",
		"Mod+ShiftLeft",
		"ControlRight",
		"Alt+AltGraph",
		"Mod+Shift",
		"Ctrl",
		"Mod+s",
		"Mod+;",
		"Mod+Key S",
		"Unidentified",
		`Mod+K${"a".repeat(32)}`,
	]) {
		expect([chord, isKeybindingChord(chord)]).toEqual([chord, false]);
	}
	expect(isKeybindingChord(3)).toBe(false);
	expect(isKeybindingChord(null)).toBe(false);
	expect(isModifierKeyCode("MetaLeft")).toBe(true);
	expect(isModifierKeyCode("KeyM")).toBe(false);
});

test("overrides map non-blank ids to chord lists; an empty list unbinds", () => {
	expect(isKeybindingOverrides({})).toBe(true);
	expect(isKeybindingOverrides({ "search.open": [], "retired.command": ["Mod+KeyK"] })).toBe(true);
	for (const value of [
		null,
		[],
		"Mod+KeyK",
		{ "search.open": "Mod+KeyK" },
		{ "search.open": ["Mod+k"] },
		{ "": ["Mod+KeyK"] },
		{ "  ": [] },
	]) {
		expect(isKeybindingOverrides(value)).toBe(false);
	}
});
