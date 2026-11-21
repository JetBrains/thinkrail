import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { revealDelta, revealHorizontally } from "./focus";

describe("how far a scroller moves to reveal the focused control", () => {
	const view = { top: 100, bottom: 400 };

	it("leaves a control that is already fully visible where it is", () => {
		expect(revealDelta(view, { top: 100, bottom: 400 })).toBe(0);
		expect(revealDelta(view, { top: 150, bottom: 200 })).toBe(0);
	});

	it("scrolls just enough to bring a control below or above fully into view", () => {
		expect(revealDelta(view, { top: 380, bottom: 440 })).toBe(40);
		expect(revealDelta(view, { top: 900, bottom: 960 })).toBe(560);
		expect(revealDelta(view, { top: 80, bottom: 140 })).toBe(-20);
		expect(revealDelta(view, { top: -500, bottom: -440 })).toBe(-600);
	});

	it("shows the top of a control taller than the scroller", () => {
		expect(revealDelta(view, { top: 300, bottom: 800 })).toBe(200);
		expect(revealDelta(view, { top: 50, bottom: 550 })).toBe(-50);
	});
});

interface FakeStyle {
	overflowX: string;
	outlineStyle: string;
	outlineWidth: string;
	outlineOffset: string;
}

interface FakeBox {
	parentElement: FakeBox | null;
	style: FakeStyle;
	left: number;
	width: number;
	clientLeft: number;
	clientWidth: number;
	scrollWidth: number;
	scrollLeft: number;
	scrollTop: number;
	getBoundingClientRect(): { left: number; right: number };
}

const box = (
	left: number,
	width: number,
	over: Partial<Omit<FakeBox, "style">> & { style?: Partial<FakeStyle> } = {},
): FakeBox => {
	const { style, ...rest } = over;
	const fake: FakeBox = {
		parentElement: null,
		style: {
			overflowX: "visible",
			outlineStyle: "none",
			outlineWidth: "0px",
			outlineOffset: "0px",
			...style,
		},
		left,
		width,
		clientLeft: 0,
		clientWidth: width,
		scrollWidth: width,
		scrollLeft: 0,
		scrollTop: 0,
		getBoundingClientRect: () => ({ left: fake.left, right: fake.left + fake.width }),
		...rest,
	};
	return fake;
};

const asElement = (fake: FakeBox) => fake as unknown as HTMLElement;

describe("revealing a tab chip in a horizontally scrolling strip", () => {
	const original = globalThis.getComputedStyle;
	beforeEach(() => {
		globalThis.getComputedStyle = ((element: FakeBox) =>
			element.style) as unknown as typeof getComputedStyle;
	});
	afterEach(() => {
		globalThis.getComputedStyle = original;
	});

	const scene = () => {
		const page = box(0, 1000, { style: { overflowX: "auto" }, scrollWidth: 2000, scrollTop: 40 });
		const row = box(100, 400, { parentElement: page });
		const strip = box(100, 300, {
			parentElement: row,
			style: { overflowX: "auto" },
			clientLeft: 1,
			clientWidth: 298,
			scrollWidth: 900,
		});
		const wrapper = box(100, 900, { parentElement: strip, style: { overflowX: "hidden" } });
		return { page, strip, wrapper };
	};

	it("scrolls only the nearest overflowing strip, just far enough for a chip past its right edge", () => {
		const { page, strip, wrapper } = scene();
		const chip = box(450, 80, { parentElement: wrapper });
		revealHorizontally(asElement(chip));
		expect(strip.scrollLeft).toBe(131);
		expect([page.scrollLeft, page.scrollTop, strip.scrollTop]).toEqual([0, 40, 0]);
	});

	it("brings a chip past the left edge back, its focus ring included, and leaves a visible one alone", () => {
		const { strip, wrapper } = scene();
		strip.scrollLeft = 200;
		const ringed = box(60, 80, {
			parentElement: wrapper,
			style: { outlineStyle: "solid", outlineWidth: "1px", outlineOffset: "1px" },
		});
		revealHorizontally(asElement(ringed));
		expect(strip.scrollLeft).toBe(157);
		const shown = box(150, 80, { parentElement: wrapper });
		revealHorizontally(asElement(shown));
		expect(strip.scrollLeft).toBe(157);
	});

	it("does nothing when no ancestor scrolls horizontally", () => {
		const row = box(0, 300, { style: { overflowX: "hidden" }, scrollWidth: 900 });
		const strip = box(0, 300, { parentElement: row, style: { overflowX: "auto" } });
		const chip = box(400, 80, { parentElement: strip });
		revealHorizontally(asElement(chip));
		expect([row.scrollLeft, strip.scrollLeft]).toEqual([0, 0]);
	});
});
