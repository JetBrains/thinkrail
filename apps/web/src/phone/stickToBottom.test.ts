import { expect, test } from "bun:test";
import { atEnd } from "./stickToBottom";

test("a scroller counts as at its end within a little slack, and not once the reader scrolled up", () => {
	expect(atEnd({ scrollHeight: 1000, scrollTop: 600, clientHeight: 400 })).toBe(true);
	expect(atEnd({ scrollHeight: 1000, scrollTop: 590, clientHeight: 400 })).toBe(true);
	expect(atEnd({ scrollHeight: 1000, scrollTop: 400, clientHeight: 400 })).toBe(false);
	expect(atEnd({ scrollHeight: 300, scrollTop: 0, clientHeight: 400 })).toBe(true);
});
