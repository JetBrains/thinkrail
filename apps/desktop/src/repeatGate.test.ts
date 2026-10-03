import { expect, test } from "bun:test";
import { createRepeatGate } from "./repeatGate";

function harness(initial: boolean | null) {
	let keyDown = initial;
	let poll: (() => void) | null = null;
	let forwards = 0;
	const gate = createRepeatGate({
		isKeyDown: () => keyDown,
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
