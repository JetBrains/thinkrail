import { expect, test } from "bun:test";
import type { ReviewAnchor } from "@thinkrail/contracts";
import {
	clampRegion,
	containedMediaRect,
	denormalizeRegion,
	normalizeRegion,
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
