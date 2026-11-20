import { expect, test } from "bun:test";
import { atEnd, stickToBottom } from "./stickToBottom";

test("a scroller counts as at its end within a little slack, and not once the reader scrolled up", () => {
	expect(atEnd({ scrollHeight: 1000, scrollTop: 600, clientHeight: 400 })).toBe(true);
	expect(atEnd({ scrollHeight: 1000, scrollTop: 590, clientHeight: 400 })).toBe(true);
	expect(atEnd({ scrollHeight: 1000, scrollTop: 400, clientHeight: 400 })).toBe(false);
	expect(atEnd({ scrollHeight: 300, scrollTop: 0, clientHeight: 400 })).toBe(true);
});

function fakeScroller() {
	const content = {};
	let onScroll = (): void => {};
	const observed: unknown[] = [];
	let resize = (): void => {};
	const scroller = {
		scrollHeight: 1000,
		scrollTop: 600,
		clientHeight: 400,
		firstElementChild: content,
		addEventListener: (_: string, listener: () => void) => {
			onScroll = listener;
		},
		removeEventListener: () => {},
	};
	class Observer {
		constructor(callback: () => void) {
			resize = callback;
		}
		observe(target: unknown) {
			observed.push(target);
		}
		disconnect() {}
	}
	const stick = stickToBottom(
		scroller as unknown as HTMLElement,
		Observer as unknown as typeof ResizeObserver,
	);
	const grow = (by: number): void => {
		scroller.scrollHeight += by;
		resize();
	};
	const scrollTo = (top: number): void => {
		scroller.scrollTop = top;
		onScroll();
	};
	return { scroller, content, observed, stick, grow, scrollTo };
}

test("a pinned chat follows its content as a streaming answer grows, watching the content as well as the box", () => {
	const { scroller, content, observed, grow } = fakeScroller();
	expect(observed).toEqual([scroller, content]);
	grow(200);
	expect(scroller.scrollTop).toBe(1200);
});

test("a reader who scrolled up stays put while the answer grows, until the chat is pinned again", () => {
	const { scroller, stick, grow, scrollTo } = fakeScroller();
	scrollTo(100);
	grow(200);
	expect(scroller.scrollTop).toBe(100);
	stick.pin();
	expect(scroller.scrollTop).toBe(1200);
	grow(50);
	expect(scroller.scrollTop).toBe(1250);
});
