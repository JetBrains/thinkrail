import { expect, test } from "bun:test";
import { isDictationChord } from "./hotkey";

const chord = (over: Partial<KeyboardEvent>) => ({
	code: "Space",
	shiftKey: true,
	altKey: false,
	ctrlKey: false,
	metaKey: false,
	...over,
});

test("the chord is Cmd+Shift+Space on Apple platforms", () => {
	expect(isDictationChord(chord({ metaKey: true }), "MacIntel")).toBe(true);
	expect(isDictationChord(chord({ ctrlKey: true }), "MacIntel")).toBe(false);
	expect(isDictationChord(chord({ metaKey: true, ctrlKey: true }), "MacIntel")).toBe(false);
});

test("the chord is Ctrl+Shift+Space elsewhere", () => {
	expect(isDictationChord(chord({ ctrlKey: true }), "Win32")).toBe(true);
	expect(isDictationChord(chord({ ctrlKey: true }), "Linux x86_64")).toBe(true);
	expect(isDictationChord(chord({ metaKey: true }), "Win32")).toBe(false);
});

test("Shift and Space are required and Alt is excluded", () => {
	expect(isDictationChord(chord({ ctrlKey: true, shiftKey: false }), "Win32")).toBe(false);
	expect(isDictationChord(chord({ ctrlKey: true, altKey: true }), "Win32")).toBe(false);
	expect(isDictationChord(chord({ ctrlKey: true, code: "KeyS" }), "Win32")).toBe(false);
});
