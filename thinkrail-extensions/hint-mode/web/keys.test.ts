import { describe, expect, it } from "bun:test";
import { HINT_KEYS, type HintKeyEvent, hintKeyAction, typeLetter } from "./keys";

const MAC = "MacIntel";
const LINUX = "Linux x86_64";

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

const idle = { active: false, platform: LINUX, textEntry: false };
const active = { active: true, platform: LINUX, textEntry: false };

describe("starting hint mode", () => {
	it("starts on a plain F outside text entry, by physical key", () => {
		expect(hintKeyAction(key({ code: "KeyF", key: "f" }), idle)).toEqual({ kind: "start" });
		expect(hintKeyAction(key({ code: "KeyF", key: "а" }), idle)).toEqual({ kind: "start" });
		expect(hintKeyAction(key({ code: "KeyA", key: "f" }), idle)).toBeNull();
	});

	it("leaves F to text fields, modifiers and key repeat", () => {
		expect(hintKeyAction(key({ code: "KeyF", key: "f" }), { ...idle, textEntry: true })).toBeNull();
		expect(hintKeyAction(key({ code: "KeyF", key: "F", shiftKey: true }), idle)).toBeNull();
		expect(hintKeyAction(key({ code: "KeyF", key: "f", ctrlKey: true }), idle)).toBeNull();
		expect(hintKeyAction(key({ code: "KeyF", key: "f", altKey: true }), idle)).toBeNull();
		expect(hintKeyAction(key({ code: "KeyF", key: "f", repeat: true }), idle)).toBeNull();
		expect(
			hintKeyAction(key({ code: "KeyF", key: "f", isComposing: true, keyCode: 229 }), idle),
		).toBeNull();
	});

	it("starts on the platform modifier + ; everywhere, text fields included", () => {
		const ctrl = key({ code: "Semicolon", key: ";", ctrlKey: true });
		const meta = key({ code: "Semicolon", key: ";", metaKey: true });
		expect(hintKeyAction(ctrl, { ...idle, textEntry: true })).toEqual({ kind: "start" });
		expect(hintKeyAction(meta, { ...idle, platform: MAC, textEntry: true })).toEqual({
			kind: "start",
		});
		expect(hintKeyAction(meta, idle)).toBeNull();
		expect(hintKeyAction(ctrl, { ...idle, platform: MAC })).toBeNull();
		expect(hintKeyAction({ ...ctrl, shiftKey: true }, idle)).toBeNull();
		expect(hintKeyAction({ ...ctrl, altKey: true }, idle)).toBeNull();
		expect(hintKeyAction(key({ code: "Semicolon", key: "ж", ctrlKey: true }), idle)).toEqual({
			kind: "start",
		});
	});
});

describe("while hint mode is active", () => {
	it("types label letters by physical key, Shift asking for focus only", () => {
		expect(hintKeyAction(key({ code: "KeyJ", key: "j" }), active)).toEqual({
			kind: "letter",
			letter: "j",
			focusOnly: false,
		});
		expect(hintKeyAction(key({ code: "KeyJ", key: "о" }), active)).toEqual({
			kind: "letter",
			letter: "j",
			focusOnly: false,
		});
		expect(hintKeyAction(key({ code: "KeyF", key: "F", shiftKey: true }), active)).toEqual({
			kind: "letter",
			letter: "f",
			focusOnly: true,
		});
	});

	it("exits on Escape or the chord again, undoes on Backspace and swallows the rest", () => {
		expect(hintKeyAction(key({ code: "Escape", key: "Escape" }), active)).toEqual({ kind: "exit" });
		expect(hintKeyAction(key({ code: "Semicolon", key: ";", ctrlKey: true }), active)).toEqual({
			kind: "exit",
		});
		expect(hintKeyAction(key({ code: "Backspace", key: "Backspace" }), active)).toEqual({
			kind: "undo",
		});
		for (const event of [
			key({ code: "KeyZ", key: "z" }),
			key({ code: "KeyJ", key: "j", ctrlKey: true }),
			key({ code: "KeyJ", key: "j", repeat: true }),
			key({ code: "KeyJ", key: "j", isComposing: true }),
			key({ code: "Tab", key: "Tab" }),
			key({ code: "KeyK", key: "k", metaKey: true }),
		]) {
			expect(hintKeyAction(event, active)).toEqual({ kind: "swallow" });
		}
	});

	it("lists the keys it matches", () => {
		expect(HINT_KEYS.show).toEqual({ code: "KeyF", key: "f" });
		expect(HINT_KEYS.toggle).toEqual({ code: "Semicolon", key: ";", mod: true });
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
