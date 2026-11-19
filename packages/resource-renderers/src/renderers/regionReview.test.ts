import { expect, test } from "bun:test";
import type { ReviewAnchor } from "@thinkrail/contracts";
import type { CursorCommand } from "../support/cursorKeys";
import { pdfRegionDraft } from "./pdf/pdfModel";
import {
	clampRegion,
	containedMediaRect,
	denormalizeRegion,
	FRAME_MIN_SIZE,
	FRAME_STEP,
	frameCommand,
	initialFrame,
	normalizeRegion,
	type Region,
	regionDraft,
	regionOfAnchor,
} from "./regionReview";

test("region math normalizes reverse drags, clamps bounds, and denormalizes", () => {
	const region = normalizeRegion(
		{ x: 180, y: 90 },
		{ x: 60, y: 10 },
		{ x: 20, y: 10, width: 200, height: 100 },
	);
	expect(region).toMatchObject({ kind: "region", x: 0.2, y: 0, height: 0.8 });
	expect(region.width).toBeCloseTo(0.6);
	const denormalized = denormalizeRegion(region, {
		x: 20,
		y: 10,
		width: 200,
		height: 100,
	});
	expect(denormalized).toMatchObject({ x: 60, y: 10, height: 80 });
	expect(denormalized.width).toBeCloseTo(120);
	expect(clampRegion({ kind: "region", x: -1, y: 0.75, width: 2, height: 0.8 })).toEqual({
		kind: "region",
		x: 0,
		y: 0.75,
		width: 1,
		height: 0.25,
	});
});

test("contain geometry centers intrinsic media inside its frame", () => {
	expect(
		containedMediaRect({ width: 400, height: 200 }, { x: 10, y: 20, width: 300, height: 300 }),
	).toEqual({ x: 10, y: 95, width: 300, height: 150 });
	expect(containedMediaRect(null, { x: 0, y: 0, width: 300, height: 300 })).toBeNull();
});

test("a letterboxed side denormalizes overlays against its displayed media", () => {
	const displayed = containedMediaRect(
		{ width: 400, height: 200 },
		{ x: 0, y: 0, width: 400, height: 400 },
	);
	expect(displayed).toEqual({ x: 0, y: 100, width: 400, height: 200 });
	if (!displayed) throw new Error("Expected contained media geometry");
	expect(
		denormalizeRegion({ kind: "region", x: 0.25, y: 0.25, width: 0.5, height: 0.5 }, displayed),
	).toEqual({ x: 100, y: 150, width: 200, height: 100 });
});

test("a region selection round-trips through a stored anchor", () => {
	const selected = normalizeRegion(
		{ x: 25, y: 30 },
		{ x: 75, y: 70 },
		{ x: 0, y: 0, width: 100, height: 100 },
	);
	const draft = regionDraft(selected);
	const anchor: ReviewAnchor = {
		path: "pixel.png",
		side: "worktree",
		contentHash: "hash",
		selectors: draft.selectors,
	};
	expect(regionOfAnchor(anchor)).toEqual(selected);
	expect(
		regionOfAnchor({
			...anchor,
			selectors: [{ kind: "region", x: Number.NaN, y: 0, width: 1, height: 1 }],
		}),
	).toBeNull();
});

const move = (direction: "up" | "down" | "left" | "right", extend = false): CursorCommand => ({
	kind: "move",
	direction,
	extend,
});

function frameAfter(region: Region, commands: CursorCommand[]): Region {
	let current = region;
	for (const command of commands) {
		const outcome = frameCommand(current, command);
		if (outcome?.kind !== "frame") throw new Error("expected a frame");
		current = outcome.region;
	}
	return current;
}

test("Enter draws a centred frame, and a second Enter comments on it", () => {
	const first = frameCommand(null, { kind: "comment" });
	expect(first).toEqual({ kind: "frame", region: initialFrame() });
	const frame = initialFrame();
	expect(frame.x + frame.width / 2).toBeCloseTo(0.5);
	expect(frame.y + frame.height / 2).toBeCloseTo(0.5);
	expect(frameCommand(frame, { kind: "comment" })).toEqual({ kind: "comment", region: frame });
	expect(frameCommand(null, move("left"))).toBeNull();
	expect(frameCommand(frame, { kind: "escape" })).toEqual({ kind: "clear" });
	expect(frameCommand(null, { kind: "escape" })).toBeNull();
});

test("arrows move the frame inside the media, Shift+arrows resize it from its corner", () => {
	const frame = initialFrame();
	const moved = frameAfter(frame, [move("right"), move("down"), move("down")]);
	expect(moved.x).toBeCloseTo(frame.x + FRAME_STEP);
	expect(moved.y).toBeCloseTo(frame.y + 2 * FRAME_STEP);
	expect(moved.width).toBe(frame.width);

	const resized = frameAfter(frame, [move("right", true), move("up", true)]);
	expect(resized.x).toBe(frame.x);
	expect(resized.width).toBeCloseTo(frame.width + FRAME_STEP);
	expect(resized.height).toBeCloseTo(frame.height - FRAME_STEP);

	const edge = frameAfter(
		frame,
		Array.from({ length: 60 }, () => move("left")),
	);
	expect(edge.x).toBe(0);
	const far = frameAfter(
		frame,
		Array.from({ length: 60 }, () => move("down")),
	);
	expect(far.y + far.height).toBeCloseTo(1);
	const tiny = frameAfter(
		frame,
		Array.from({ length: 60 }, () => move("left", true)),
	);
	expect(tiny.width).toBe(FRAME_MIN_SIZE);
	const wide = frameAfter(
		frame,
		Array.from({ length: 60 }, () => move("right", true)),
	);
	expect(wide.x + wide.width).toBeCloseTo(1);
});

test("a keyboard frame anchors exactly like a drag over the same rectangle", () => {
	const frame = frameAfter(initialFrame(), [move("right"), move("down", true)]);
	const bounds = { x: 10, y: 20, width: 400, height: 200 };
	const dragged = normalizeRegion(
		{ x: bounds.x + frame.x * bounds.width, y: bounds.y + frame.y * bounds.height },
		{
			x: bounds.x + (frame.x + frame.width) * bounds.width,
			y: bounds.y + (frame.y + frame.height) * bounds.height,
		},
		bounds,
	);
	const [keyboard] = regionDraft(frame).selectors;
	const [drag] = regionDraft(dragged).selectors;
	if (keyboard?.kind !== "region" || drag?.kind !== "region") throw new Error("expected regions");
	for (const key of ["x", "y", "width", "height"] as const)
		expect(keyboard[key]).toBeCloseTo(drag[key]);
	expect(pdfRegionDraft(frame, 3).selectors[0]).toMatchObject({ kind: "region", page: 3 });
});
