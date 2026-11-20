import { describe, expect, test } from "bun:test";
import {
	flashesOnArrival,
	type LandingLookup,
	orderRegions,
	type RegionKind,
	regionKeyAction,
	resolveEscapeLanding,
	resolveLanding,
} from "./regions";

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

	test("visits Peek after the center and the right side, before the bottom", () => {
		const shuffled = [
			region("bottom", "bottom", 700, 300),
			region("peek", "peek", 40, 1100),
			region("center", "center", 40, 300),
		];
		expect(names(orderRegions(shuffled))).toEqual(["center", "peek", "bottom"]);
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

describe("landing in a region", () => {
	const lookup = (found: Partial<Record<keyof LandingLookup<string>, string>>) => ({
		claim: () => found.claim ?? null,
		remembered: () => found.remembered ?? null,
		preferred: () => found.preferred ?? null,
		selectedTab: () => found.selectedTab ?? null,
		first: () => found.first ?? null,
	});

	test("a waiting question's focus claim wins over the remembered element and the default", () => {
		expect(
			resolveLanding(
				lookup({ claim: "option", remembered: "composer", preferred: "composer", first: "tab" }),
			),
		).toBe("option");
	});

	test("without a claim, the remembered element, then the default, the selected tab and the first stop", () => {
		expect(resolveLanding(lookup({ remembered: "row", preferred: "composer" }))).toBe("row");
		expect(resolveLanding(lookup({ preferred: "composer", selectedTab: "tab" }))).toBe("composer");
		expect(resolveLanding(lookup({ selectedTab: "tab", first: "button" }))).toBe("tab");
		expect(resolveLanding(lookup({ first: "button" }))).toBe("button");
		expect(resolveLanding(lookup({}))).toBeNull();
	});
});

describe("where an Esc lands in a region or the main area", () => {
	const lookup = (found: { claim?: string; park?: string; rest?: string }) => ({
		claim: () => found.claim ?? null,
		park: () => found.park ?? null,
		rest: () => found.rest ?? null,
	});

	test("a waiting question's claim first, then the park, then the rest", () => {
		expect(resolveEscapeLanding(lookup({ claim: "option", park: "feed", rest: "root" }))).toBe(
			"option",
		);
		expect(resolveEscapeLanding(lookup({ park: "feed", rest: "root" }))).toBe("feed");
		expect(resolveEscapeLanding(lookup({ rest: "editor" }))).toBe("editor");
		expect(resolveEscapeLanding(lookup({}))).toBeNull();
	});
});
