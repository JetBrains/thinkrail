import { describe, expect, test } from "bun:test";
import { revealScrollTop } from "./scrollGeometry";

const viewport = {
	scrollTop: 400,
	maxScrollTop: 1_000,
	viewportTop: 100,
	viewportBottom: 500,
};

function reveal(targetTop: number, targetBottom: number, block: "start" | "nearest") {
	return revealScrollTop({ ...viewport, targetTop, targetBottom }, block);
}

describe("revealScrollTop", () => {
	test("leaves an already visible target unchanged for nearest reveal", () => {
		expect(reveal(180, 240, "nearest")).toBe(400);
		expect(reveal(100, 500, "nearest")).toBe(400);
	});

	test("reveals targets above and below with the nearest edge", () => {
		expect(reveal(20, 80, "nearest")).toBe(320);
		expect(reveal(550, 650, "nearest")).toBe(550);
	});

	test("aligns a target start independently of its bottom edge", () => {
		expect(reveal(20, 80, "start")).toBe(320);
		expect(reveal(550, 650, "start")).toBe(850);
		expect(reveal(180, 900, "start")).toBe(480);
	});

	test("uses the useful edge when an oversized target is outside the viewport", () => {
		expect(reveal(550, 1_000, "nearest")).toBe(850);
		expect(reveal(-50, 400, "nearest")).toBe(300);
	});

	test("does not move nearest reveal when an oversized target spans the viewport", () => {
		expect(reveal(50, 650, "nearest")).toBe(400);
		expect(reveal(50, 650, "start")).toBe(350);
	});

	test("clamps destinations to the available scroll range", () => {
		expect(reveal(-500, -400, "start")).toBe(0);
		expect(reveal(1_800, 2_000, "nearest")).toBe(1_000);
		expect(
			revealScrollTop(
				{
					scrollTop: 0,
					maxScrollTop: 0,
					viewportTop: 100,
					viewportBottom: 500,
					targetTop: 800,
					targetBottom: 900,
				},
				"start",
			),
		).toBe(0);
	});
});
