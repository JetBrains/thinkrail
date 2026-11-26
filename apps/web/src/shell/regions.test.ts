import { describe, expect, test } from "bun:test";
import { flashesOnArrival, orderRegions, type RegionKind, regionKeyAction } from "./regions";

const region = (name: string, kind: RegionKind, top: number, left: number) => ({
	name,
	kind,
	rect: { top, left },
});

const names = (regions: ReadonlyArray<{ name: string }>) => regions.map(({ name }) => name);

describe("region ring order", () => {
	test("runs top bar, left top to bottom, center, right, then bottom left to right", () => {
		const shuffled = [
			region("bottom-right", "bottom", 700, 900),
			region("right", "right", 40, 1200),
			region("center-a", "center", 40, 300),
			region("left-lower", "left", 400, 40),
			region("bottom-left", "bottom", 700, 300),
			region("topbar", "topbar", 0, 0),
			region("left-upper", "left", 40, 40),
			region("center-b", "center", 40, 800),
		];
		expect(names(orderRegions(shuffled))).toEqual([
			"topbar",
			"left-upper",
			"left-lower",
			"center-a",
			"center-b",
			"right",
			"bottom-left",
			"bottom-right",
		]);
	});

	test("keeps center groups in document order, the order Ctrl+F6 walks", () => {
		const nested = [
			region("first", "center", 40, 300),
			region("below-first", "center", 400, 300),
			region("beside", "center", 40, 800),
		];
		expect(names(orderRegions(nested))).toEqual(["first", "below-first", "beside"]);
	});

	test("puts the Project Home pane right after the top bar", () => {
		expect(
			names(orderRegions([region("projects", "home", 40, 40), region("topbar", "topbar", 0, 0)])),
		).toEqual(["topbar", "projects"]);
	});
});

describe("F6 rhythm", () => {
	test("a first press with focus in the active region only lights its frame", () => {
		expect(regionKeyAction({ flashVisible: false, focusInActiveRegion: true })).toBe("flash");
	});

	test("a press while the frame is still visible moves to the next region", () => {
		expect(regionKeyAction({ flashVisible: true, focusInActiveRegion: true })).toBe("move");
	});

	test("focus outside the active region, on <body> or with none active, moves at once", () => {
		expect(regionKeyAction({ flashVisible: false, focusInActiveRegion: false })).toBe("move");
		expect(regionKeyAction({ flashVisible: true, focusInActiveRegion: false })).toBe("move");
	});
});

describe("arrival frame", () => {
	test("flashes when a key press brought focus into a different region", () => {
		expect(flashesOnArrival("chat", "terminal", true)).toBe(true);
		expect(flashesOnArrival(null, "topbar", true)).toBe(true);
	});

	test("never flashes after a pointer press", () => {
		expect(flashesOnArrival("chat", "terminal", false)).toBe(false);
		expect(flashesOnArrival(null, "topbar", false)).toBe(false);
	});

	test("never flashes for a move inside the same region", () => {
		expect(flashesOnArrival("chat", "chat", true)).toBe(false);
	});
});
