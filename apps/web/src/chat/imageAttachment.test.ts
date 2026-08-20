import { describe, expect, test } from "bun:test";
import { fitWithin, MAX_ATTACHMENT_EDGE } from "./imageAttachment";

// The pure dimension math behind the composer's attach-time downscale (TASK-image-attachment-downscale):
// images are capped at MAX_ATTACHMENT_EDGE (1568px — Claude's own standard-tier long edge; anything
// larger is downsampled provider-side anyway and only risks the 2000px many-image 400). The browser
// decode/re-encode half lives in `fileToAttachedImage` and is exercised end-to-end by
// `e2e/composer-images.spec.ts` (bun's DOM has no real image codec).

describe("fitWithin", () => {
	test("returns the input unchanged when both edges are within the limit", () => {
		expect(fitWithin(800, 600, 1568)).toEqual({ width: 800, height: 600 });
		expect(fitWithin(1568, 1568, 1568)).toEqual({ width: 1568, height: 1568 });
	});

	test("scales a landscape image down to the long edge, preserving aspect", () => {
		expect(fitWithin(3136, 1568, 1568)).toEqual({ width: 1568, height: 784 });
		expect(fitWithin(4000, 3000, 1568)).toEqual({ width: 1568, height: 1176 });
	});

	test("scales a portrait image down to the long edge, preserving aspect", () => {
		expect(fitWithin(1568, 3136, 1568)).toEqual({ width: 784, height: 1568 });
		expect(fitWithin(3000, 4000, 1568)).toEqual({ width: 1176, height: 1568 });
	});

	test("rounds fractional results to whole pixels", () => {
		const { width, height } = fitWithin(3023, 1701, 1568);
		expect(width).toBe(1568);
		expect(height).toBe(882); // 1701 * (1568 / 3023) = 882.16…
	});

	test("never collapses an extreme aspect ratio to zero", () => {
		const { width, height } = fitWithin(100_000, 10, 1568);
		expect(width).toBe(1568);
		expect(height).toBeGreaterThanOrEqual(1);
	});

	test("the exported default edge is Claude's 1568px standard-tier long edge", () => {
		expect(MAX_ATTACHMENT_EDGE).toBe(1568);
	});
});
