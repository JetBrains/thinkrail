import { describe, expect, it } from "bun:test";
import { HINT_KEYS, type HintKeyEvent, hintKeyAction, SHOW_HINTS, typeLetter } from "./keys";

function key(init: Partial<HintKeyEvent> & Pick<HintKeyEvent, "code" | "key">): HintKeyEvent {
	return {
		altKey: false,
		ctrlKey: false,
		metaKey: false,
		shiftKey: false,
		repeat: false,
		isComposing: false,
		keyCode: 0,
		...init,
	};
}

const SHOW = SHOW_HINTS.id;

describe("the trigger is the host's command, not a key hint mode matches", () => {
	it("declares F and Mod+; as the one command's default chords", () => {
		expect(SHOW_HINTS).toEqual({
			id: "hint-mode.show",
			title: "hintMode.shortcuts.show",
			chords: [
				{ code: "KeyF", key: "f" },
				{ code: "Semicolon", key: ";", mod: true },
			],
		});
	});

	it("lists the in-mode keys it handles itself", () => {
		expect(HINT_KEYS).toEqual({
			focusOnly: { code: "ShiftLeft", key: "Shift" },
			undo: { code: "Backspace", key: "Backspace" },
			exit: { code: "Escape", key: "Escape" },
		});
	});
});

describe("while hint mode is active", () => {
	it("types label letters by physical key, Shift asking for focus only", () => {
		expect(hintKeyAction(key({ code: "KeyJ", key: "j" }), null)).toEqual({
			kind: "letter",
			letter: "j",
			focusOnly: false,
		});
		expect(hintKeyAction(key({ code: "KeyJ", key: "о" }), null)).toEqual({
			kind: "letter",
			letter: "j",
			focusOnly: false,
		});
		expect(hintKeyAction(key({ code: "KeyF", key: "F", shiftKey: true }), null)).toEqual({
			kind: "letter",
			letter: "f",
			focusOnly: true,
		});
	});

	it("keeps F a label letter even though the host reports it as the trigger", () => {
		expect(hintKeyAction(key({ code: "KeyF", key: "f" }), SHOW)).toEqual({
			kind: "letter",
			letter: "f",
			focusOnly: false,
		});
	});

	it("exits on Escape or on a trigger chord that is not a letter, and undoes on Backspace", () => {
		expect(hintKeyAction(key({ code: "Escape", key: "Escape" }), null)).toEqual({ kind: "exit" });
		expect(hintKeyAction(key({ code: "Semicolon", key: ";", ctrlKey: true }), SHOW)).toEqual({
			kind: "exit",
		});
		expect(hintKeyAction(key({ code: "KeyF", key: "f", ctrlKey: true }), SHOW)).toEqual({
			kind: "exit",
		});
		expect(hintKeyAction(key({ code: "Semicolon", key: ";", ctrlKey: true }), null)).toEqual({
			kind: "swallow",
		});
		expect(
			hintKeyAction(key({ code: "Semicolon", key: ";", ctrlKey: true }), "other.command"),
		).toEqual({ kind: "swallow" });
		expect(hintKeyAction(key({ code: "Backspace", key: "Backspace" }), null)).toEqual({
			kind: "undo",
		});
	});

	it("swallows every other key, repeats and IME composition included", () => {
		for (const [event, command] of [
			[key({ code: "KeyZ", key: "z" }), null],
			[key({ code: "KeyJ", key: "j", ctrlKey: true }), null],
			[key({ code: "KeyJ", key: "j", repeat: true }), null],
			[key({ code: "KeyJ", key: "j", isComposing: true }), null],
			[key({ code: "KeyJ", key: "j", keyCode: 229 }), null],
			[key({ code: "Escape", key: "Escape", repeat: true }), null],
			[key({ code: "Semicolon", key: ";", ctrlKey: true, repeat: true }), SHOW],
			[key({ code: "Semicolon", key: ";", ctrlKey: true, isComposing: true }), SHOW],
			[key({ code: "Tab", key: "Tab" }), null],
			[key({ code: "KeyK", key: "k", metaKey: true }), null],
		] as const) {
			expect(hintKeyAction(event, command)).toEqual({ kind: "swallow" });
		}
	});
});

describe("typeLetter", () => {
	const labels = ["s", "d", "aa", "as", ""];

	it("narrows by prefix and chooses on a complete label", () => {
		expect(typeLetter(labels, "", "a")).toEqual({ typed: "a", chosen: null });
		expect(typeLetter(labels, "a", "s")).toEqual({ typed: "as", chosen: 3 });
		expect(typeLetter(labels, "", "s")).toEqual({ typed: "s", chosen: 0 });
	});

	it("ignores a letter no shown label continues with", () => {
		expect(typeLetter(labels, "", "z")).toBeNull();
		expect(typeLetter(labels, "a", "d")).toBeNull();
	});
});
