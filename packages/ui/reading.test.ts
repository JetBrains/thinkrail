import { describe, expect, it } from "bun:test";
import { ARROW_TWIN_COMMANDS } from "./keyboard";
import { localKeys } from "./local-keys";
import {
	READING_COMMANDS,
	READING_LINE,
	readingCommand,
	readingPage,
	readingScrollTarget,
	scrollBeforeStep,
	stepRevealDelta,
} from "./reading";

const keys = localKeys(null, "reader", [...READING_COMMANDS, ...ARROW_TWIN_COMMANDS]);

const LETTER = /^[a-z]$/i;

function press(init: Partial<KeyboardEvent> & { key: string }) {
	return {
		code: LETTER.test(init.key)
			? `Key${init.key.toUpperCase()}`
			: init.key === " "
				? "Space"
				: init.key,
		shiftKey: false,
		altKey: false,
		ctrlKey: false,
		metaKey: false,
		isComposing: false,
		keyCode: 0,
		target: null,
		...init,
	};
}

const command = (init: Partial<KeyboardEvent> & { key: string }) =>
	readingCommand(press(init), keys);

describe("reading keys", () => {
	it("reads the arrows and their letter twins as a line or a step sideways", () => {
		expect(command({ key: "ArrowDown" })).toEqual({ kind: "line", direction: 1 });
		expect(command({ key: "j" })).toEqual({ kind: "line", direction: 1 });
		expect(command({ key: "k" })).toEqual({ kind: "line", direction: -1 });
		expect(command({ key: "h" })).toEqual({ kind: "side", direction: -1 });
		expect(command({ key: "ArrowRight" })).toEqual({ kind: "side", direction: 1 });
	});

	it("pages with Space, Shift+Space, PgDn and PgUp", () => {
		expect(command({ key: " " })).toEqual({ kind: "page", direction: 1 });
		expect(command({ key: " ", shiftKey: true })).toEqual({ kind: "page", direction: -1 });
		expect(command({ key: "PageDown" })).toEqual({ kind: "page", direction: 1 });
		expect(command({ key: "PageUp" })).toEqual({ kind: "page", direction: -1 });
	});

	it("goes to the ends with g, Shift+G, Home and End, by physical key", () => {
		expect(command({ key: "g" })).toEqual({ kind: "edge", direction: -1 });
		expect(command({ key: "G", code: "KeyG", shiftKey: true })).toEqual({
			kind: "edge",
			direction: 1,
		});
		expect(command({ key: "п", code: "KeyG" })).toEqual({ kind: "edge", direction: -1 });
		expect(command({ key: "Home" })).toEqual({ kind: "edge", direction: -1 });
		expect(command({ key: "End" })).toEqual({ kind: "edge", direction: 1 });
	});

	it("leaves modified, shifted and composing presses alone", () => {
		expect(command({ key: "J", code: "KeyJ", shiftKey: true })).toBeNull();
		expect(command({ key: "ArrowDown", shiftKey: true })).toBeNull();
		expect(command({ key: "End", ctrlKey: true })).toBeNull();
		expect(command({ key: " ", ctrlKey: true, shiftKey: true })).toBeNull();
		expect(command({ key: "j", isComposing: true })).toBeNull();
		expect(command({ key: "x" })).toBeNull();
	});

	it("follows a rebound twin and drops its default", () => {
		const rebound = localKeys(
			{
				platform: "Linux x86_64",
				scopes: new Map([["reader", [{ id: "arrows.down", chord: { code: "KeyU", key: "U" } }]]]),
				isTextEntry: () => false,
			},
			"reader",
			[],
		);
		expect(readingCommand(press({ key: "u" }), rebound)).toEqual({ kind: "line", direction: 1 });
		expect(readingCommand(press({ key: "j" }), rebound)).toBeNull();
		expect(readingCommand(press({ key: "g" }), rebound)).toBeNull();
	});
});

describe("scroll before step", () => {
	const view = { top: 100, bottom: 500 };

	it("scrolls a line inside an item whose far edge is still out of view", () => {
		expect(scrollBeforeStep(view, { top: 120, bottom: 1200 }, 1)).toBe(READING_LINE);
		expect(scrollBeforeStep(view, { top: -600, bottom: 450 }, -1)).toBe(-READING_LINE);
	});

	it("stops exactly at the item's edge", () => {
		expect(scrollBeforeStep(view, { top: 120, bottom: 515 }, 1)).toBe(15);
		expect(scrollBeforeStep(view, { top: 75, bottom: 300 }, -1)).toBe(-25);
	});

	it("lets the cursor step once that edge shows", () => {
		expect(scrollBeforeStep(view, { top: 120, bottom: 500 }, 1)).toBe(0);
		expect(scrollBeforeStep(view, { top: 120, bottom: 501 }, 1)).toBe(0);
		expect(scrollBeforeStep(view, { top: 100, bottom: 900 }, -1)).toBe(0);
		expect(scrollBeforeStep(view, { top: 120, bottom: 1200 }, -1)).toBe(0);
	});
});

describe("revealing the item a step lands on", () => {
	const view = { top: 100, bottom: 500 };

	it("does not move for an item already in view", () => {
		expect(stepRevealDelta(view, { top: 200, bottom: 300 })).toBe(0);
	});

	it("brings a short item wholly into view", () => {
		expect(stepRevealDelta(view, { top: 450, bottom: 560 })).toBe(60);
		expect(stepRevealDelta(view, { top: 60, bottom: 160 })).toBe(-40);
	});

	it("shows only the near edge and a line of a tall item", () => {
		expect(stepRevealDelta(view, { top: 300, bottom: 1400 })).toBe(0);
		expect(stepRevealDelta(view, { top: 480, bottom: 1400 })).toBe(20);
		expect(stepRevealDelta(view, { top: 700, bottom: 1800 })).toBe(240);
		expect(stepRevealDelta(view, { top: -900, bottom: 120 })).toBe(-20);
	});
});

describe("plain scroller targets", () => {
	const scroll = {
		scrollTop: 100,
		scrollLeft: 0,
		clientHeight: 400,
		clientWidth: 300,
		scrollHeight: 2000,
		scrollWidth: 320,
	};

	it("moves a line, a page (the viewport less a line) and to the ends, inside the bounds", () => {
		expect(readingScrollTarget({ kind: "line", direction: 1 }, scroll).top).toBe(140);
		expect(
			readingScrollTarget({ kind: "line", direction: -1 }, { ...scroll, scrollTop: 10 }).top,
		).toBe(0);
		expect(readingPage(400)).toBe(360);
		expect(readingScrollTarget({ kind: "page", direction: 1 }, scroll).top).toBe(460);
		expect(readingScrollTarget({ kind: "edge", direction: 1 }, scroll).top).toBe(1600);
		expect(readingScrollTarget({ kind: "edge", direction: -1 }, scroll).top).toBe(0);
	});

	it("scrolls sideways within the overflow", () => {
		expect(readingScrollTarget({ kind: "side", direction: 1 }, scroll)).toEqual({
			top: 100,
			left: 20,
		});
		expect(readingScrollTarget({ kind: "side", direction: -1 }, scroll).left).toBe(0);
	});
});
