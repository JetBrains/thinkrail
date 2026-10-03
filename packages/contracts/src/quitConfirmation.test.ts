import { expect, test } from "bun:test";
import type { NativeQuitHint } from "./nativeClient";
import { createQuitConfirmation, QUIT_CONFIRMATION } from "./quitConfirmation";

const { holdMs, doublePressMs, pollMs } = QUIT_CONFIRMATION;

function harness(hintVisible = true) {
	let time = 0;
	let held: boolean | null = true;
	let poll: (() => void) | null = null;
	const hints: NativeQuitHint[] = [];
	let quits = 0;
	const confirmation = createQuitConfirmation({
		readHeld: () => held,
		canShowHint: () => hintVisible,
		quit: () => {
			quits += 1;
		},
		onHint: (hint) => hints.push(hint),
		now: () => time,
		every: (callback, ms) => {
			expect(ms).toBe(pollMs);
			poll = callback;
			return () => {
				poll = null;
			};
		},
	});
	function advance(ms: number) {
		const end = time + ms;
		while (time < end) {
			time = Math.min(end, time + pollMs);
			poll?.();
		}
	}
	return {
		confirmation,
		hints,
		advance,
		setHeld: (next: boolean | null) => {
			held = next;
		},
		quits: () => quits,
		polling: () => poll !== null,
	};
}

test("a tap expires, a double press quits on release", () => {
	const tap = harness();
	tap.confirmation.press(true);
	tap.setHeld(false);
	tap.confirmation.sync();
	tap.advance(doublePressMs + pollMs);
	expect(tap.hints).toEqual(["armed", "hidden"]);
	expect(tap.polling()).toBe(false);

	const double = harness();
	double.confirmation.press(true);
	double.setHeld(false);
	double.confirmation.sync();
	double.setHeld(true);
	double.confirmation.press(true);
	double.setHeld(false);
	double.confirmation.sync();
	expect(double.hints).toEqual(["armed", "release", "quitting"]);
	expect(double.quits()).toBe(1);
});

test("a hold quits only after release", () => {
	const h = harness();
	h.confirmation.press(true);
	h.advance(holdMs + pollMs);
	expect(h.quits()).toBe(0);
	h.setHeld(false);
	h.confirmation.sync();
	expect(h.quits()).toBe(1);
});

test("cancel hides an unconfirmed gesture and quits a confirmed one", () => {
	const early = harness();
	early.confirmation.cancel();
	early.confirmation.press(true);
	early.confirmation.cancel();
	expect(early.hints).toEqual(["armed", "hidden"]);
	expect(early.quits()).toBe(0);

	const confirmed = harness();
	confirmed.confirmation.press(true);
	confirmed.advance(holdMs);
	confirmed.confirmation.cancel();
	confirmed.confirmation.cancel();
	expect(confirmed.hints).toEqual(["armed", "release", "quitting"]);
	expect(confirmed.quits()).toBe(1);
});

test("quitNow is idempotent and wins over later presses", () => {
	const h = harness();
	h.confirmation.quitNow();
	h.confirmation.quitNow();
	h.confirmation.press(true);
	expect(h.hints).toEqual(["quitting"]);
	expect(h.quits()).toBe(1);
});

test("without a visible hint a held press quits on release", () => {
	const h = harness(false);
	h.confirmation.press(true);
	expect(h.hints).toEqual(["release"]);
	h.setHeld(false);
	h.advance(pollMs);
	expect(h.quits()).toBe(1);
});

test("reset after a quit lets the next press arm again", () => {
	const h = harness();
	h.confirmation.quitNow();
	h.confirmation.press(true);
	expect(h.hints).toEqual(["quitting"]);
	h.confirmation.reset();
	h.confirmation.press(true);
	expect(h.hints).toEqual(["quitting", "hidden", "armed"]);
	expect(h.quits()).toBe(1);
});

test("the double-press window starts at release", () => {
	const h = harness();
	h.confirmation.press(true);
	h.advance(440);
	h.setHeld(false);
	h.advance(pollMs);
	h.advance(doublePressMs - 2 * pollMs);
	h.setHeld(true);
	h.confirmation.press(true);
	expect(h.hints).toEqual(["armed", "release"]);
});

test("a press after the window expires re-arms", () => {
	const h = harness();
	h.confirmation.press(true);
	h.setHeld(false);
	h.advance(doublePressMs + 2 * pollMs);
	h.setHeld(true);
	h.confirmation.press(true);
	expect(h.hints).toEqual(["armed", "hidden", "armed"]);
	expect(h.quits()).toBe(0);
});

test("a second press with keys already released quits at once", () => {
	const h = harness();
	h.confirmation.press(true);
	h.setHeld(false);
	h.advance(120);
	h.confirmation.press(false);
	expect(h.hints).toEqual(["armed", "quitting"]);
	expect(h.quits()).toBe(1);
});

test("unreadable key state hides before confirmation and quits after it", () => {
	const early = harness();
	early.confirmation.press(true);
	early.setHeld(null);
	early.advance(pollMs);
	expect(early.hints).toEqual(["armed", "hidden"]);
	expect(early.quits()).toBe(0);
	expect(early.polling()).toBe(false);

	const confirmed = harness();
	confirmed.confirmation.press(true);
	confirmed.setHeld(false);
	confirmed.advance(pollMs);
	confirmed.setHeld(true);
	confirmed.confirmation.press(true);
	confirmed.setHeld(null);
	confirmed.advance(pollMs);
	expect(confirmed.hints).toEqual(["armed", "release", "quitting"]);
	expect(confirmed.quits()).toBe(1);
});

test("presses while holding or awaiting release are ignored", () => {
	const h = harness();
	h.confirmation.press(true);
	h.advance(pollMs);
	h.confirmation.press(true);
	expect(h.hints).toEqual(["armed"]);
	h.advance(holdMs);
	h.confirmation.press(false);
	expect(h.hints).toEqual(["armed", "release"]);
	expect(h.quits()).toBe(0);
});
