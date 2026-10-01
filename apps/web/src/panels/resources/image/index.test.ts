import { expect, test } from "bun:test";
import type { ResourceRenderer, ReviewThread } from "@/resources";
import { registerResourceRenderer, resolveRenderers } from "@/resources";
import { placedRegionThreadIds } from "../regionReview";
import { imageRenderer } from ".";
import {
	clampImageZoom,
	formatByteLength,
	imageDiffViewState,
	imageSourceUrl,
	imageViewState,
	nextWheelZoom,
} from "./imageState";

test("image renderer registration declares image matching and region anchors", () => {
	expect(imageRenderer).toMatchObject({
		id: "thinkrail/image",
		label: "Image",
		match: { mime: ["image/*"], text: false },
		rank: 120,
		capabilities: {
			anchors: { view: ["region"], diff: ["region"] },
			mobile: true,
			copy: false,
			layout: false,
			whitespace: false,
		},
	});
});

test("image extensions match when MIME metadata is absent", () => {
	const fallback: ResourceRenderer = {
		id: "thinkrail/binary",
		label: "File",
		match: { text: false },
		rank: 0,
		capabilities: {
			view: true,
			diff: true,
			anchors: { view: [], diff: [] },
			mobile: true,
			copy: false,
			layout: false,
			whitespace: false,
		},
	};
	const disposers = [fallback, imageRenderer].map(registerResourceRenderer);
	try {
		expect(
			resolveRenderers({ workspaceId: "ws", path: "photo.avif", text: false }, "view", {
				mobile: false,
			}).map((renderer) => renderer.id),
		).toEqual(["thinkrail/image", "thinkrail/binary"]);
	} finally {
		for (const dispose of disposers.reverse()) dispose();
	}
});

test("file-backed image URLs follow content hashes while blob URLs stay immutable", () => {
	expect(imageSourceUrl("https://host/files/ws/photo.png", "hash one")).toBe(
		"https://host/files/ws/photo.png?h=hash%20one",
	);
	expect(imageSourceUrl("https://host/files/ws/photo.png", "hash-two")).not.toBe(
		imageSourceUrl("https://host/files/ws/photo.png", "hash-one"),
	);
	expect(imageSourceUrl("https://host/blob/ws/oid/photo.png", "hash")).toBe(
		"https://host/blob/ws/oid/photo.png",
	);
});

test("image regions stay unplaced until intrinsic dimensions load", () => {
	const thread: ReviewThread = {
		id: "region-1",
		anchor: {
			path: "photo.png",
			side: "worktree",
			selectors: [{ kind: "region", x: 0.1, y: 0.2, width: 0.3, height: 0.4 }],
		},
		body: "pixel",
		status: "draft",
		anchorState: "anchored",
	};
	expect(placedRegionThreadIds([thread], null)).toEqual(new Set());
	expect(placedRegionThreadIds([thread], { width: 640, height: 480 })).toEqual(
		new Set(["region-1"]),
	);
});

test("image zoom state is bounded and defaults to 2-up diffs", () => {
	expect(clampImageZoom(100)).toBe(8);
	expect(clampImageZoom(0)).toBe(0.1);
	expect(nextWheelZoom(1, -100)).toBeGreaterThan(1);
	expect(imageViewState({ mode: "zoom", zoom: 2 })).toEqual({ mode: "zoom", zoom: 2 });
	expect(imageDiffViewState(undefined)).toBe("2-up");
	expect(imageDiffViewState({ mode: "onion" })).toBe("onion");
	expect(formatByteLength(1536)).toBe("1.5 KB");
});
