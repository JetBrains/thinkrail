import { expect, test } from "bun:test";
import { createRepeatGate } from "./repeatGate";

function harness(initial: boolean | null, initialSince: number | null = 0) {
	let keyDown = initial;
	let since = initialSince;
	let poll: (() => void) | null = null;
	let forwards = 0;
	const gate = createRepeatGate({
		isKeyDown: () => keyDown,
		sinceKeyDown: () => since,
		every: (callback) => {
			poll = callback;
			return () => {
				poll = null;
			};
		},
	});
	return {
		press: () =>
			gate(() => {
				forwards += 1;
			}),
		setKeyDown: (next: boolean | null) => {
			keyDown = next;
		},
		setSinceKeyDown: (seconds: number | null) => {
			since = seconds;
		},
		tick: () => poll?.(),
		forwards: () => forwards,
		polling: () => poll !== null,
	};
}

test("drops key-repeats until the key is released", () => {
	const h = harness(true);
	h.press();
	h.press();
	h.tick();
	h.press();
	h.press();
	expect(h.forwards()).toBe(1);
	h.setKeyDown(false);
	h.tick();
	expect(h.polling()).toBe(false);
	h.setKeyDown(true);
	h.press();
	expect(h.forwards()).toBe(2);
});

test("a repeating key keeps the latch armed — events keep arriving", () => {
	const h = harness(true, 0.01);
	h.press();
	expect(h.forwards()).toBe(1);
	h.setSinceKeyDown(0.05);
	h.tick();
	h.press();
	expect(h.forwards()).toBe(1);
	h.setSinceKeyDown(0.1);
	h.tick();
	h.press();
	expect(h.forwards()).toBe(1);
	expect(h.polling()).toBe(true);
});

test("a stale key state — held with no key-down events — releases the latch (#1199)", () => {
	const h = harness(true, 0.05);
	h.press();
	expect(h.forwards()).toBe(1);
	expect(h.polling()).toBe(true);
	h.setSinceKeyDown(4.2);
	h.tick();
	expect(h.polling()).toBe(false);
	h.press();
	expect(h.forwards()).toBe(2);
});

test("a long macOS delay-until-repeat keeps the latch armed before the first repeat", () => {
	const h = harness(true, 0.01);
	h.press();
	h.setSinceKeyDown(1.9);
	h.tick();
	h.press();
	expect(h.forwards()).toBe(1);
	expect(h.polling()).toBe(true);
});

test("release still wins when the key genuinely lifts", () => {
	const h = harness(true, 0.05);
	h.press();
	h.setKeyDown(false);
	h.tick();
	expect(h.polling()).toBe(false);
});

test("unreadable key freshness falls back to trusting the state", () => {
	const fresh = harness(true, null);
	fresh.press();
	fresh.tick();
	fresh.press();
	expect(fresh.forwards()).toBe(1);

	const turnedUnreadable = harness(true, 0.05);
	turnedUnreadable.press();
	turnedUnreadable.setSinceKeyDown(null);
	turnedUnreadable.tick();
	turnedUnreadable.press();
	expect(turnedUnreadable.forwards()).toBe(1);
});

test("forwards every menu click made with no key down", () => {
	const h = harness(false);
	h.press();
	h.press();
	expect(h.forwards()).toBe(2);
	expect(h.polling()).toBe(false);
});

test("never latches when key state is unreadable, up front or mid-poll", () => {
	const unreadable = harness(null);
	unreadable.press();
	unreadable.press();
	expect(unreadable.forwards()).toBe(2);

	const midPoll = harness(true);
	midPoll.press();
	midPoll.setKeyDown(null);
	midPoll.tick();
	midPoll.press();
	expect(midPoll.forwards()).toBe(2);
});
