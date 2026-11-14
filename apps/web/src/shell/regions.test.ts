import { describe, expect, test } from "bun:test";
import { orderRegions, type RegionKind, regionDimAttribute } from "./regions";

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

describe("the inactive-region scrim switch", () => {
	test("keeps the scrim when the panels are dimmed", () => {
		expect(regionDimAttribute(true)).toBeNull();
	});

	test("drops the scrim when the panels are not dimmed", () => {
		expect(regionDimAttribute(false)).toBe("off");
	});
});
