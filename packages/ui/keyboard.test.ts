import { describe, expect, test } from "bun:test";
import { isImeComposing, yieldEscapeToIme } from "./keyboard";

function escapeEvent(init: { isComposing: boolean; keyCode: number }) {
	let prevented = false;
	const event = {
		key: "Escape",
		...init,
		preventDefault: () => {
			prevented = true;
		},
	} as unknown as KeyboardEvent;
	return { event, prevented: () => prevented };
}

describe("isImeComposing", () => {
	test("an event inside a composition belongs to the IME", () => {
		expect(isImeComposing({ isComposing: true, keyCode: 13 })).toBe(true);
	});

	test("the 229 sentinel belongs to the IME after compositionend already fired", () => {
		expect(isImeComposing({ isComposing: false, keyCode: 229 })).toBe(true);
	});

	test("an ordinary key is the field's own", () => {
		expect(isImeComposing({ isComposing: false, keyCode: 13 })).toBe(false);
		expect(isImeComposing({ isComposing: false, keyCode: 27 })).toBe(false);
	});
});

describe("yieldEscapeToIme", () => {
	test("a composing Escape keeps the layer open and skips the caller's handler", () => {
		for (const init of [
			{ isComposing: true, keyCode: 27 },
			{ isComposing: false, keyCode: 229 },
		]) {
			const calls: KeyboardEvent[] = [];
			const { event, prevented } = escapeEvent(init);
			yieldEscapeToIme((e) => calls.push(e))(event);
			expect(prevented()).toBe(true);
			expect(calls).toEqual([]);
		}
	});

	test("an ordinary Escape reaches the caller and leaves dismissal to Radix", () => {
		const calls: KeyboardEvent[] = [];
		const { event, prevented } = escapeEvent({ isComposing: false, keyCode: 27 });
		yieldEscapeToIme((e) => calls.push(e))(event);
		expect(calls).toEqual([event]);
		expect(prevented()).toBe(false);
	});

	test("an ordinary Escape without a caller handler is left untouched", () => {
		const { event, prevented } = escapeEvent({ isComposing: false, keyCode: 27 });
		yieldEscapeToIme(undefined)(event);
		expect(prevented()).toBe(false);
	});
});
