import { expect, test } from "bun:test";
import { createKeyStateReader, decodeKeyState, type KeySample } from "./keyState";

const COMMAND_KEYCODE = 55;
const Q_KEYCODE = 12;
const COMMAND_FLAG = 0x100000n;

function sample(overrides: Partial<KeySample> = {}): KeySample {
	return {
		isKeyDown: () => false,
		flags: 0n,
		sinceMouseUp: 10,
		sinceKeyDown: 1,
		sinceFlagsChanged: 2,
		...overrides,
	};
}

function keysDown(...keycodes: number[]) {
	return (keycode: number) => keycodes.includes(keycode);
}

test("a held modifier does not count as a held key", () => {
	const state = decodeKeyState(sample({ isKeyDown: keysDown(COMMAND_KEYCODE) }));
	expect(state.keyDown).toBe(false);
	expect(state.downKeys).toEqual([]);
});

test("a held letter counts and is listed by keycode", () => {
	const state = decodeKeyState(sample({ isKeyDown: keysDown(COMMAND_KEYCODE, Q_KEYCODE) }));
	expect(state.keyDown).toBe(true);
	expect(state.downKeys).toEqual([Q_KEYCODE]);
});

test("the Command flag bit sets cmdDown", () => {
	expect(decodeKeyState(sample({ flags: COMMAND_FLAG })).cmdDown).toBe(true);
	expect(decodeKeyState(sample({ flags: 0x20000n })).cmdDown).toBe(false);
});

test("event ages decide mouse and modifier ordering", () => {
	const mouseLast = decodeKeyState(sample({ sinceMouseUp: 0.1, sinceKeyDown: 1 }));
	expect(mouseLast.mouseAfterKey).toBe(true);
	expect(decodeKeyState(sample()).mouseAfterKey).toBe(false);
	expect(decodeKeyState(sample({ sinceKeyDown: 1, sinceFlagsChanged: 2 })).keyAfterModifiers).toBe(
		true,
	);
	expect(decodeKeyState(sample({ sinceKeyDown: 3, sinceFlagsChanged: 2 })).keyAfterModifiers).toBe(
		false,
	);
});

test("the reader is unavailable off macOS", () => {
	expect(createKeyStateReader("linux")()).toBeNull();
	expect(createKeyStateReader("win32")()).toBeNull();
});
