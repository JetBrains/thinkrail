import { expect, test } from "bun:test";
import { isDictationChord, stopsDictation } from "./hotkey";

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

test("a bare Esc stops a connecting or listening dictation in its field, and only there", () => {
	const field = { contains: (node: Node | null) => node === inside };
	const inside = {} as Node;
	const outside = {} as Node;
	const esc = {
		key: "Escape",
		altKey: false,
		ctrlKey: false,
		metaKey: false,
		shiftKey: false,
		isComposing: false,
		keyCode: 27,
		defaultPrevented: false,
	};
	expect(stopsDictation(esc, field, inside, "listening")).toBe(true);
	expect(stopsDictation(esc, field, inside, "connecting")).toBe(true);
	expect(stopsDictation(esc, null, inside, "listening")).toBe(false);
	expect(stopsDictation(esc, field, outside, "listening")).toBe(false);
	expect(stopsDictation({ ...esc, defaultPrevented: true }, field, inside, "listening")).toBe(
		false,
	);
	expect(stopsDictation({ ...esc, shiftKey: true }, field, inside, "listening")).toBe(false);
	expect(
		stopsDictation({ ...esc, isComposing: true, keyCode: 229 }, field, inside, "listening"),
	).toBe(false);
	expect(stopsDictation({ ...esc, key: "Enter" }, field, inside, "listening")).toBe(false);
});

test("an Esc while a dictation is already stopping is left to the shell, so it leaves the field", () => {
	const inside = {} as Node;
	const field = { contains: (node: Node | null) => node === inside };
	const esc = {
		key: "Escape",
		altKey: false,
		ctrlKey: false,
		metaKey: false,
		shiftKey: false,
		isComposing: false,
		keyCode: 27,
		defaultPrevented: false,
	};
	expect(stopsDictation(esc, field, inside, "stopping")).toBe(false);
	expect(stopsDictation(esc, field, inside, "idle")).toBe(false);
});
