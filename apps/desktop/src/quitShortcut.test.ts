import { expect, test } from "bun:test";
import { type NativeQuitHint, QUIT_CONFIRMATION } from "@thinkrail/contracts";
import type { KeyState } from "./keyState";
import { createQuitShortcut } from "./quitShortcut";

const {
	holdMs: QUIT_HOLD_MS,
	doublePressMs: QUIT_DOUBLE_PRESS_MS,
	pollMs: QUIT_POLL_MS,
} = QUIT_CONFIRMATION;

function keys(keyDown: boolean, cmdDown: boolean, mouseAfterKey = false): KeyState {
	return {
		keyDown,
		cmdDown,
		mouseAfterKey,
	};
}

const up = keys(false, false);
const menuClick = keys(false, false, true);
const keyOnly = keys(true, false);
const both = keys(true, true);

function harness(initialKeys: KeyState | null = both, hintVisible = true) {
	let time = 0;
	let current = initialKeys;
	let poll: (() => void) | null = null;
	const hints: NativeQuitHint[] = [];
	let quits = 0;
	const shortcut = createQuitShortcut({
		readKeys: () => current,
		canShowHint: () => hintVisible,
		quit: () => {
			quits += 1;
		},
		onHint: (hint) => hints.push(hint),
		now: () => time,
		every: (callback, ms) => {
			expect(ms).toBe(QUIT_POLL_MS);
			poll = callback;
			return () => {
				poll = null;
			};
		},
	});
	function advance(ms: number) {
		const end = time + ms;
		while (time < end) {
			time = Math.min(end, time + QUIT_POLL_MS);
			poll?.();
		}
	}
	return {
		shortcut,
		hints,
		advance,
		setKeys: (next: KeyState | null) => {
			current = next;
		},
		quits: () => quits,
		polling: () => poll !== null,
	};
}

test("a menu click with no keys down quits directly", () => {
	const h = harness(menuClick);
	h.shortcut.press();
	expect(h.hints).toEqual(["quitting"]);
	expect(h.quits()).toBe(1);
	expect(h.polling()).toBe(false);
});

test("falls back to a direct quit when key state is unavailable", () => {
	const h = harness(null);
	h.shortcut.press();
	expect(h.quits()).toBe(1);
});

test("releasing Cmd after the threshold also quits", () => {
	const h = harness();
	h.shortcut.press();
	h.advance(QUIT_HOLD_MS + QUIT_POLL_MS);
	h.setKeys(keyOnly);
	h.advance(QUIT_POLL_MS);
	expect(h.quits()).toBe(1);
});

test("a tap handled after both keys are up arms instead of quitting", () => {
	const h = harness(up);
	h.shortcut.press();
	expect(h.hints).toEqual(["armed"]);
	expect(h.quits()).toBe(0);
	h.advance(QUIT_DOUBLE_PRESS_MS + QUIT_POLL_MS);
	expect(h.hints).toEqual(["armed", "hidden"]);
});
