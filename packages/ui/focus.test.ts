import { describe, expect, it } from "bun:test";
import { revealDelta } from "./focus";

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
