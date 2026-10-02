import type { ReviewAnchor, ReviewSelector } from "@thinkrail/contracts";
import type { AnchorDraft, ReviewThread } from "@/resources";

export type Region = Extract<ReviewSelector, { kind: "region" }>;

export interface Point {
	x: number;
	y: number;
}

export interface Size {
	width: number;
	height: number;
}

export interface Rect extends Size {
	x: number;
	y: number;
}

export function clamp(value: number, minimum = 0, maximum = 1): number {
	return Math.min(maximum, Math.max(minimum, value));
}

export function clampRegion(region: Region): Region {
	const x = clamp(region.x);
	const y = clamp(region.y);
	return {
		kind: "region",
		x,
		y,
		width: clamp(region.width, 0, 1 - x),
		height: clamp(region.height, 0, 1 - y),
		...(region.page === undefined ? {} : { page: region.page }),
	};
}

export function containedMediaRect(intrinsic: Size | null, frame: Rect): Rect | null {
	if (
		!intrinsic ||
		![intrinsic.width, intrinsic.height, frame.width, frame.height].every(
			(value) => Number.isFinite(value) && value > 0,
		)
	) {
		return null;
	}
	const scale = Math.min(frame.width / intrinsic.width, frame.height / intrinsic.height);
	const width = intrinsic.width * scale;
	const height = intrinsic.height * scale;
	return {
		x: frame.x + (frame.width - width) / 2,
		y: frame.y + (frame.height - height) / 2,
		width,
		height,
	};
}

export function normalizeRegion(start: Point, end: Point, bounds: Rect): Region {
	if (bounds.width <= 0 || bounds.height <= 0) {
		return { kind: "region", x: 0, y: 0, width: 0, height: 0 };
	}
	const startX = clamp((start.x - bounds.x) / bounds.width);
	const startY = clamp((start.y - bounds.y) / bounds.height);
	const endX = clamp((end.x - bounds.x) / bounds.width);
	const endY = clamp((end.y - bounds.y) / bounds.height);
	return {
		kind: "region",
		x: Math.min(startX, endX),
		y: Math.min(startY, endY),
		width: Math.abs(endX - startX),
		height: Math.abs(endY - startY),
	};
}

export function denormalizeRegion(region: Region, bounds: Rect): Rect {
	const normalized = clampRegion(region);
	return {
		x: bounds.x + normalized.x * bounds.width,
		y: bounds.y + normalized.y * bounds.height,
		width: normalized.width * bounds.width,
		height: normalized.height * bounds.height,
	};
}

export function regionOfAnchor(anchor: ReviewAnchor): Region | null {
	const selector = anchor.selectors.find((candidate) => candidate.kind === "region");
	if (selector?.kind !== "region") return null;
	const values = [selector.x, selector.y, selector.width, selector.height];
	if (values.some((value) => !Number.isFinite(value) || value < 0 || value > 1)) return null;
	if (selector.page !== undefined && (!Number.isInteger(selector.page) || selector.page < 1)) {
		return null;
	}
	return clampRegion(selector);
}

export function regionDraft(region: Region): AnchorDraft {
	return { selectors: [clampRegion(region)], label: "region" };
}

export function placedRegionThreadIds(
	threads: readonly ReviewThread[],
	intrinsic: Size | null,
): ReadonlySet<string> {
	if (
		!intrinsic ||
		![intrinsic.width, intrinsic.height].every((value) => Number.isFinite(value) && value > 0)
	) {
		return new Set();
	}
	return new Set(threads.flatMap((thread) => (regionOfAnchor(thread.anchor) ? [thread.id] : [])));
}
