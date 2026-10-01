import { expect, test } from "bun:test";
import type { ReviewAnchor } from "@thinkrail/contracts";
import {
	anchorLabel,
	type ResourceRenderer,
	type ReviewThread,
	registerResourceRenderer,
	resolveRenderers,
} from "@/resources";
import { denormalizeRegion, normalizeRegion } from "../regionReview";
import { pdfRenderer } from ".";
import { PdfRenderQueue } from "./pdfLoader";
import {
	pdfCurrentPage,
	pdfFocusPending,
	pdfPageContentStamp,
	pdfPageReleasePlan,
	pdfRegionDraft,
	pdfRegionOfAnchor,
	pdfRenderWindow,
	pdfSourceUrl,
	pdfViewState,
	placedPdfThreadIds,
	resolvePdfPage,
	updatePdfPageSet,
} from "./pdfModel";
import { releasePdfCanvas } from "./pdfRender";

test("PDF renderer registration declares MIME matching and paged region anchors", () => {
	expect(pdfRenderer).toMatchObject({
		id: "thinkrail/pdf",
		label: "PDF",
		match: { mime: ["application/pdf"], text: false },
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

test("a .pdf extension resolves through inferred MIME metadata", () => {
	const binary: ResourceRenderer = {
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
	const disposers = [binary, pdfRenderer].map(registerResourceRenderer);
	try {
		expect(
			resolveRenderers({ workspaceId: "ws", path: "report.pdf", text: false }, "view", {
				mobile: false,
			}).map((renderer) => renderer.id),
		).toEqual(["thinkrail/pdf", "thinkrail/binary"]);
	} finally {
		for (const dispose of disposers.reverse()) dispose();
	}
});

test("PDF page region math round-trips normalized canvas geometry", () => {
	const region = normalizeRegion(
		{ x: 75, y: 100 },
		{ x: 225, y: 300 },
		{ x: 25, y: 50, width: 400, height: 500 },
	);
	const draft = pdfRegionDraft(region, 3);
	expect(draft).toEqual({
		selectors: [{ ...region, page: 3 }],
		label: "p3 region",
	});
	const anchor: ReviewAnchor = {
		path: "report.pdf",
		side: "worktree",
		selectors: draft.selectors,
	};
	expect(pdfRegionOfAnchor(anchor, 3)).toEqual({ ...region, page: 3 });
	expect(pdfRegionOfAnchor(anchor, 2)).toBeNull();
	expect(anchorLabel(anchor)).toBe("p3 region");
	expect(denormalizeRegion(region, { x: 25, y: 50, width: 400, height: 500 })).toEqual({
		x: 75,
		y: 100,
		width: 150,
		height: 200,
	});
});

test("PDF placement is known from page count and ignores bitmap residency", () => {
	const thread: ReviewThread = {
		id: "pdf-thread",
		anchor: {
			path: "report.pdf",
			side: "worktree",
			selectors: [{ kind: "region", x: 0.1, y: 0.2, width: 0.3, height: 0.4, page: 2 }],
		},
		body: "page note",
		status: "draft",
		anchorState: "anchored",
	};
	expect(placedPdfThreadIds([thread], 1)).toEqual(new Set());
	expect(placedPdfThreadIds([thread], 2)).toEqual(new Set(["pdf-thread"]));
	expect(placedPdfThreadIds([thread], 20)).toEqual(new Set(["pdf-thread"]));
});

test("PDF focus stays pending through metadata and page rendering", () => {
	const unknown = resolvePdfPage(20, null);
	expect(unknown).toEqual({ state: "unknown", page: 20 });
	expect(pdfFocusPending(unknown, new Set())).toBe(true);
	const placeable = resolvePdfPage(20, 30);
	expect(placeable).toEqual({ state: "placeable", page: 20 });
	expect(pdfFocusPending(placeable, new Set())).toBe(true);
	expect(pdfFocusPending(placeable, new Set([20]))).toBe(false);
	const unplaceable = resolvePdfPage(20, 10);
	expect(unplaceable).toEqual({ state: "unplaceable", page: 20 });
	expect(pdfFocusPending(unplaceable, new Set())).toBe(false);
});

test("PDF render windows include visible pages plus two and prioritize a forced focus page", () => {
	expect(pdfRenderWindow(new Set([5]), 20)).toEqual(new Set([3, 4, 5, 6, 7]));
	expect(pdfRenderWindow(new Set([1]), 20)).toEqual(new Set([1, 2, 3]));
	expect(pdfRenderWindow(new Set([5]), 30, 20)).toEqual(new Set([18, 19, 20, 21, 22]));
});

test("PDF render queue removes work aborted before it starts", async () => {
	const queue = new PdfRenderQueue(1);
	let finishFirst: (() => void) | null = null;
	const first = queue.run(
		() =>
			new Promise<void>((resolve) => {
				finishFirst = resolve;
			}),
	);
	let secondRan = false;
	const controller = new AbortController();
	const second = queue.run(async () => {
		secondRan = true;
	}, controller.signal);
	controller.abort();
	await expect(second).rejects.toThrow("PDF render cancelled");
	if (!finishFirst) throw new Error("Expected the first render to start");
	finishFirst();
	await first;
	expect(secondRan).toBe(false);
});

test("PDF release bookkeeping drops residents outside the render window", () => {
	const residents = new Set([3, 4, 8]);
	const plan = pdfPageReleasePlan(residents, new Set([2, 3, 4, 5, 6]));
	expect(plan.retained).toEqual(new Set([3, 4]));
	expect(plan.released).toEqual(new Set([8]));
	const stable = pdfPageReleasePlan(plan.retained, new Set([3, 4]));
	expect(stable.retained).toBe(plan.retained);
	expect(stable.released).toEqual(new Set());
});

test("PDF canvas release drops its backing dimensions", () => {
	const canvas = { width: 1600, height: 900 };
	releasePdfCanvas(canvas);
	expect(canvas).toEqual({ width: 0, height: 0 });
});

test("PDF page-set tracking preserves identity for no-op updates", () => {
	const first = updatePdfPageSet(new Set<number>(), 2, true);
	expect(first).toEqual(new Set([2]));
	expect(updatePdfPageSet(first, 2, true)).toBe(first);
	expect(updatePdfPageSet(first, 2, false)).toEqual(new Set());
});

test("PDF composer stamps use document identity and page but not zoom", () => {
	const identity = JSON.stringify(["/files/ws/report.pdf", "hash"]);
	const stampForState = (state: unknown) => pdfPageContentStamp(identity, pdfViewState(state).page);
	const atOneZoom = stampForState({ page: 4, zoom: 1 });
	const atAnotherZoom = stampForState({ page: 4, zoom: 2 });
	expect(atAnotherZoom).toBe(atOneZoom);
	expect(pdfPageContentStamp(identity, 5)).not.toBe(atOneZoom);
	expect(pdfPageContentStamp(`${identity}:changed`, 4)).not.toBe(atOneZoom);
});

test("PDF URLs hash-bust mutable file routes and view state is bounded", () => {
	expect(pdfSourceUrl("/files/ws/report.pdf", "hash one")).toBe(
		"/files/ws/report.pdf?h=hash%20one",
	);
	expect(pdfSourceUrl("/blob/ws/oid/report.pdf", "hash")).toBe("/blob/ws/oid/report.pdf");
	expect(pdfViewState({ page: 4, zoom: 99 })).toEqual({ page: 4, zoom: 3 });
});

test("the current page is the first visible page and falls back to the navigation target", () => {
	expect(pdfCurrentPage(new Set([41, 39, 40]), 1)).toBe(39);
	expect(pdfCurrentPage(new Set(), 7)).toBe(7);
});
