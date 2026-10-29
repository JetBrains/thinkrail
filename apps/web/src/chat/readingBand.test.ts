import { describe, expect, it } from "bun:test";
import {
	createReadingBandController,
	headerHeightScrollTarget,
	type ReadingBandEnvironment,
	type ReadingBandGeometry,
} from "./readingBand";

const TALL_ARRIVAL_SETTLE_MS = 300;

interface Harness {
	controller: ReturnType<typeof createReadingBandController>;
	anchors: Array<{ index: number; inset: number }>;
	writes: number[];
	runwayHeights: number[];
	setGeometry: (patch: Partial<ReadingBandGeometry>) => void;
	setRowTop: (id: string, top: number | null) => void;
	setReferenceRow: (row: { id: string; top: number } | null) => void;
	readGeometry: () => ReadingBandGeometry;
	readRunwayHeight: () => number;
	setGeometryAvailable: (available: boolean) => void;
	advance: (milliseconds: number) => void;
	pendingFrames: () => number;
	cancelledFrames: () => number;
	stateChanges: () => number;
}

function createHarness({
	streaming = true,
	reducedMotion = false,
	viewportHeight = 600,
	latestEdge = "bottom",
	geometryAvailable = true,
	runwayWritable = true,
	movement = { trigger: 100 },
	mountPending = false,
}: {
	streaming?: boolean;
	reducedMotion?: boolean;
	viewportHeight?: number;
	latestEdge?: "top" | "bottom";
	geometryAvailable?: boolean;
	runwayWritable?: boolean;
	movement?: { trigger: number };
	mountPending?: boolean;
} = {}): Harness {
	let geometry: ReadingBandGeometry = {
		viewportHeight,
		scrollTop: 100,
		maxScrollTop: 1_000,
		edgeBottom: viewportHeight * 0.5,
	};
	let hasGeometry = geometryAvailable;
	let now = 0;
	let frameId = 0;
	let cancelled = 0;
	let published = 0;
	const frames = new Map<number, (time: number) => void>();
	const anchors: Array<{ index: number; inset: number }> = [];
	const writes: number[] = [];
	const runwayHeights: number[] = [];
	const rowTops = new Map<string, number>();
	let referenceRow: { id: string; top: number } | null = null;
	let runwayHeight = 0;

	const environment: ReadingBandEnvironment = {
		readGeometry: () => (hasGeometry ? geometry : null),
		readScrollBounds: () => geometry,
		readViewportHeight: () => geometry.viewportHeight,
		readReferenceRow: () => (referenceRow ? { ...referenceRow } : null),
		readRowTop: (id) => rowTops.get(id) ?? null,
		writeScrollTop: (top) => {
			const bounded = Math.min(geometry.maxScrollTop, Math.max(0, top));
			writes.push(bounded);
			const delta = bounded - geometry.scrollTop;
			geometry = {
				...geometry,
				scrollTop: bounded,
				edgeBottom: geometry.edgeBottom === null ? null : geometry.edgeBottom - delta,
			};
		},
		writeRunwayHeight: (height) => {
			if (!runwayWritable) return;
			const next = Math.max(0, height);
			const nextMaxScrollTop = Math.max(0, geometry.maxScrollTop + next - runwayHeight);
			runwayHeight = next;
			runwayHeights.push(next);
			if (geometry.scrollTop <= nextMaxScrollTop) {
				geometry = { ...geometry, maxScrollTop: nextMaxScrollTop };
				return;
			}
			const delta = nextMaxScrollTop - geometry.scrollTop;
			writes.push(nextMaxScrollTop);
			geometry = {
				...geometry,
				scrollTop: nextMaxScrollTop,
				maxScrollTop: nextMaxScrollTop,
				edgeBottom: geometry.edgeBottom === null ? null : geometry.edgeBottom - delta,
			};
		},
		anchorTurn: (index, inset) => anchors.push({ index, inset }),
		prefersReducedMotion: () => reducedMotion,
		now: () => now,
		requestFrame: (callback) => {
			frameId += 1;
			frames.set(frameId, callback);
			return frameId;
		},
		cancelFrame: (id) => {
			if (frames.delete(id)) cancelled += 1;
		},
		onStateChange: () => {
			published += 1;
		},
	};
	const controller = createReadingBandController(environment, {
		streaming,
		latestEdge,
		movement,
		mountPending,
	});

	return {
		controller,
		anchors,
		writes,
		runwayHeights,
		setGeometry: (patch) => {
			geometry = { ...geometry, ...patch };
		},
		setRowTop: (id, top) => {
			if (top === null) rowTops.delete(id);
			else rowTops.set(id, top);
		},
		setReferenceRow: (row) => {
			referenceRow = row ? { ...row } : null;
			if (row) rowTops.set(row.id, row.top);
		},
		readGeometry: () => geometry,
		readRunwayHeight: () => runwayHeight,
		setGeometryAvailable: (available) => {
			hasGeometry = available;
		},
		advance: (milliseconds) => {
			now += milliseconds;
			const pending = [...frames.values()];
			frames.clear();
			for (const callback of pending) callback(now);
		},
		pendingFrames: () => frames.size,
		cancelledFrames: () => cancelled,
		stateChanges: () => published,
	};
}

function advanceUntilIdle(harness: Harness, limit = 300) {
	for (let frame = 0; frame < limit && harness.pendingFrames() > 0; frame += 1) {
		harness.advance(16);
	}
	expect(harness.pendingFrames()).toBe(0);
}

function startPinned(harness: Harness) {
	harness.controller.contentChanged();
	harness.setGeometry({ scrollTop: 100, maxScrollTop: 100, edgeBottom: 601 });
	harness.controller.contentChanged();
	harness.advance(TALL_ARRIVAL_SETTLE_MS);
}

function grow(harness: Harness, pixels: number) {
	const current = harness.readGeometry();
	harness.setGeometry({
		edgeBottom: (current.edgeBottom ?? 0) + pixels,
		maxScrollTop: current.maxScrollTop + pixels,
	});
	harness.controller.contentChanged();
}

describe("reading-band newest-first header", () => {
	it("compensates a detached reader from its pre-resize scroll position", () => {
		const bounds = { scrollTop: 500, maxScrollTop: 1_000 };
		expect(headerHeightScrollTarget(400, 48, 92, bounds, "top", false)).toBe(444);
		expect(headerHeightScrollTarget(400, 92, 60, bounds, "top", false)).toBe(368);
	});

	it("does not double-apply an implicit bottom clamp after header shrink", () => {
		expect(
			headerHeightScrollTarget(1_000, 92, 60, { scrollTop: 968, maxScrollTop: 968 }, "top", false),
		).toBe(968);
	});

	it("does not compensate while following or in oldest-first", () => {
		const bounds = { scrollTop: 400, maxScrollTop: 1_000 };
		expect(headerHeightScrollTarget(400, 48, 92, bounds, "top", true)).toBe(400);
		expect(headerHeightScrollTarget(400, 48, 92, bounds, "bottom", false)).toBe(400);
	});
});

describe("reading-band turn anchoring", () => {
	it("anchors an immediate turn at 10% of the viewport, clamped to 48–80px", () => {
		for (const [viewportHeight, inset] of [
			[320, 48],
			[600, 60],
			[1_200, 80],
		] as const) {
			const harness = createHarness({ streaming: false, viewportHeight });
			harness.controller.armImmediateTurn();
			harness.controller.userTurnArrived(7, "immediate");
			expect(harness.anchors).toEqual([]);
			harness.advance(0);
			expect(harness.anchors).toEqual([{ index: 7, inset }]);
			expect(harness.controller.getSnapshot()).toEqual({
				following: true,
				moving: false,
				runway: true,
				buttonLabel: null,
			});
		}
	});

	it("anchors without a mounted stream marker and allocates no speculative room", () => {
		const harness = createHarness({
			streaming: false,
			viewportHeight: 600,
			latestEdge: "top",
			geometryAvailable: false,
		});
		harness.controller.armImmediateTurn();
		harness.controller.userTurnArrived(0, "immediate");
		harness.advance(0);
		expect(harness.anchors).toEqual([{ index: 0, inset: 60 }]);
		expect(harness.runwayHeights).toEqual([]);
		harness.setGeometryAvailable(true);
		harness.controller.contentChanged();
		expect(harness.runwayHeights).toEqual([]);
	});

	it("keeps idle latest-edge reconciliation behind an armed immediate-turn anchor", () => {
		const harness = createHarness({ streaming: false, reducedMotion: true });
		harness.controller.armImmediateTurn();
		harness.controller.userTurnArrived(3, "immediate");
		harness.advance(0);
		expect(harness.anchors).toEqual([{ index: 3, inset: 60 }]);
		harness.setGeometry({ scrollTop: 100, maxScrollTop: 500 });
		harness.controller.contentChanged();
		expect(harness.writes).toEqual([]);
	});

	it("cancels only the local immediate arm when another client already started work", () => {
		const harness = createHarness({ streaming: false });
		harness.controller.armImmediateTurn();
		harness.controller.setStreaming(true);
		harness.controller.cancelImmediateTurn(true);
		expect(harness.controller.getSnapshot()).toMatchObject({
			following: true,
			runway: true,
			buttonLabel: null,
		});
	});

	it("anchors a queued turn only while the reader is still following", () => {
		const harness = createHarness();
		harness.controller.userTurnArrived(4, "queued");
		harness.advance(0);
		harness.controller.readerLeft();
		harness.controller.userTurnArrived(8, "queued");
		expect(harness.anchors).toEqual([{ index: 4, inset: 60 }]);
	});

	it("cancels a pending turn anchor when the reader moves first", () => {
		const harness = createHarness({ streaming: false });
		harness.controller.armImmediateTurn();
		harness.controller.userTurnArrived(3, "immediate");
		harness.controller.readerLeft();
		harness.advance(16);
		expect(harness.anchors).toEqual([]);
	});
});

describe("reading-band movement", () => {
	it("pins one large layout expansion to the pin line in the same callback", () => {
		const harness = createHarness();
		harness.setGeometry({ edgeBottom: 900, maxScrollTop: 900 });
		harness.controller.contentChanged();
		expect(harness.writes).toEqual([400]);
		expect(harness.readGeometry().edgeBottom).toBe(600);
		expect(harness.pendingFrames()).toBe(0);
		expect(harness.controller.getMotionKind()).toBeNull();
	});

	it("pins the response edge in newest-first order too", () => {
		const harness = createHarness({ latestEdge: "top" });
		harness.setGeometry({ edgeBottom: 601 });
		harness.controller.contentChanged();
		expect(harness.writes).toEqual([101]);
	});

	it("re-pins immediately when the pin line changes", () => {
		const harness = createHarness({ reducedMotion: true });
		harness.setGeometry({ edgeBottom: 500 });
		harness.controller.contentChanged();
		expect(harness.writes).toEqual([]);
		harness.controller.setMovement({ trigger: 80 });
		expect(harness.writes).toEqual([120]);
	});

	it("re-pins when the live viewport shrinks", () => {
		const harness = createHarness({ reducedMotion: true });
		harness.setGeometry({ scrollTop: 100, maxScrollTop: 100, edgeBottom: 500 });
		harness.controller.contentChanged();
		expect(harness.writes).toEqual([]);
		harness.setGeometry({ viewportHeight: 400, maxScrollTop: 300 });
		harness.controller.contentChanged();
		expect(harness.runwayHeights).toEqual([]);
		expect(harness.writes).toEqual([200]);
	});
});

describe("reading-band newest-row arrival", () => {
	it("returns a following newest-first reader to the new top row with the shared smooth move", () => {
		const harness = createHarness({ latestEdge: "top" });
		harness.setGeometry({ scrollTop: 300, maxScrollTop: 900 });
		harness.controller.latestRowArrived(0);
		expect(harness.pendingFrames()).toBe(1);
		harness.advance(219);
		expect(harness.writes.at(-1)).toBeGreaterThan(0);
		harness.advance(1);
		expect(harness.writes.at(-1)).toBe(0);
	});

	it("returns to a prepended row before its stream marker mounts", () => {
		const harness = createHarness({ latestEdge: "top", geometryAvailable: false });
		harness.setGeometry({ scrollTop: 300, maxScrollTop: 900 });
		harness.controller.latestRowArrived(0);
		harness.advance(220);
		expect(harness.writes.at(-1)).toBe(0);
	});

	it("cancels a prepended-row move before anchoring a queued continuation", () => {
		const harness = createHarness({ latestEdge: "top" });
		harness.setGeometry({ scrollTop: 300, maxScrollTop: 900 });
		harness.controller.latestRowArrived(0);
		harness.controller.userTurnArrived(0, "queued");
		harness.advance(220);
		expect(harness.cancelledFrames()).toBe(1);
		expect(harness.writes).toEqual([]);
		expect(harness.anchors).toEqual([{ index: 0, inset: 60 }]);
	});

	it("does not move a detached reader or the bottom-latest mode for a prepended row", () => {
		for (const [latestEdge, detached] of [
			["top", true],
			["bottom", false],
		] as const) {
			const harness = createHarness({ latestEdge });
			harness.setGeometry({ scrollTop: 300, maxScrollTop: 900 });
			if (detached) harness.controller.readerLeft();
			harness.controller.latestRowArrived(0);
			expect(harness.pendingFrames()).toBe(0);
			expect(harness.writes).toEqual([]);
		}
	});
});

describe("reading-band reader intent", () => {
	it("cancels an in-flight Follow response move and ignores later content growth", () => {
		const harness = createHarness();
		harness.controller.readerLeft();
		harness.setGeometry({ edgeBottom: 900 });
		harness.controller.returnToEdge();
		harness.advance(100);
		const writesBeforeLeaving = harness.writes.length;
		harness.controller.readerLeft();
		harness.advance(120);
		harness.setGeometry({ edgeBottom: 1_000 });
		harness.controller.contentChanged();
		expect(harness.writes).toHaveLength(writesBeforeLeaving);
		expect(harness.cancelledFrames()).toBe(1);
		expect(harness.controller.getSnapshot()).toEqual({
			following: false,
			moving: false,
			runway: false,
			buttonLabel: "Follow response",
		});
	});

	it("cancels controller movement for a local reveal without changing follow state", () => {
		const following = createHarness();
		following.controller.readerLeft();
		following.setGeometry({ edgeBottom: 900 });
		following.controller.returnToEdge();
		expect(following.controller.getSnapshot().moving).toBe(true);
		following.controller.cancelMovement();
		expect(following.pendingFrames()).toBe(0);
		expect(following.cancelledFrames()).toBe(1);
		expect(following.controller.getSnapshot()).toMatchObject({ following: true, moving: false });

		const detached = createHarness();
		detached.controller.readerLeft();
		detached.controller.cancelMovement();
		expect(detached.controller.getSnapshot().following).toBe(false);
	});

	it("pauses for potential native input without detaching and can resume alignment", () => {
		const harness = createHarness({ streaming: false });
		harness.controller.returnToEdge();
		expect(harness.controller.getSnapshot()).toMatchObject({ following: true, moving: true });

		const resume = harness.controller.interruptForNativeInput();
		expect(harness.cancelledFrames()).toBe(1);
		expect(harness.controller.getSnapshot()).toMatchObject({ following: true, moving: false });

		resume();
		harness.advance(220);
		expect(harness.writes.at(-1)).toBe(1_000);
		expect(harness.controller.getSnapshot()).toMatchObject({ following: true, buttonLabel: null });

		const detached = createHarness();
		detached.controller.readerLeft();
		detached.controller.revealTo(() => 700, true);
		const resumeDetached = detached.controller.interruptForNativeInput();
		expect(detached.controller.getSnapshot()).toMatchObject({ following: false, moving: false });
		resumeDetached();
		expect(detached.controller.getSnapshot()).toMatchObject({ following: false, moving: true });
	});

	it("keeps wheel or keyboard outcome pending while controller motion is paused", () => {
		const harness = createHarness({ streaming: false });
		harness.controller.returnToEdge();

		const resume = harness.controller.interruptForNativeInput("pending");
		expect(harness.pendingFrames()).toBe(0);
		expect(harness.controller.getSnapshot()).toMatchObject({ following: true, moving: true });

		resume();
		expect(harness.pendingFrames()).toBe(1);
		harness.advance(220);
		expect(harness.writes.at(-1)).toBe(1_000);
	});

	it("keeps active streaming runway intact across a no-move native pause", () => {
		const harness = createHarness();
		harness.setGeometry({
			scrollTop: 100,
			maxScrollTop: 100,
			edgeBottom: 751,
		});
		harness.controller.contentChanged();
		expect(harness.runwayHeights).toEqual([151]);

		const resume = harness.controller.interruptForNativeInput();
		expect(harness.runwayHeights).toEqual([151]);
		expect(harness.controller.getSnapshot()).toMatchObject({
			following: true,
			moving: false,
			runway: true,
		});

		resume();
		advanceUntilIdle(harness);
		expect(harness.writes.at(-1)).toBeCloseTo(251, 8);
		expect(harness.controller.getSnapshot()).toMatchObject({ following: true, runway: true });
	});

	it("moves an automatic reveal through the shared motion without detaching", () => {
		const harness = createHarness();
		harness.controller.revealTo(() => 700, false);
		expect(harness.pendingFrames()).toBe(1);
		harness.advance(220);
		expect(harness.writes.at(-1)).toBe(700);
		expect(harness.controller.getSnapshot().following).toBe(true);
	});

	it("owns detached fold-anchor stabilization and yields it to reader input", () => {
		const harness = createHarness();
		harness.controller.readerLeft();
		let target = 100;
		harness.controller.stabilizeAnchor(() => target);
		expect(harness.pendingFrames()).toBe(1);
		target = 260;
		harness.controller.refreshAnchor();
		expect(harness.writes.at(-1)).toBe(260);
		harness.advance(16);
		expect(harness.writes.at(-1)).toBe(260);
		expect(harness.controller.getSnapshot()).toMatchObject({ following: false, moving: true });

		const writesBeforeInput = harness.writes.length;
		harness.controller.cancelReveal();
		harness.advance(16);
		expect(harness.writes).toHaveLength(writesBeforeInput);
		expect(harness.pendingFrames()).toBe(0);
		expect(harness.controller.getSnapshot()).toMatchObject({ following: false, moving: false });
	});

	it("applies a pending fold-anchor correction before native input or a newer change supersedes it", () => {
		for (const supersede of ["native-input", "newer-change"] as const) {
			const harness = createHarness();
			harness.controller.readerLeft();
			let target = 100;
			harness.controller.stabilizeAnchor(() => target);
			target = 260;
			if (supersede === "native-input") harness.controller.interruptForNativeInput("pending");
			else harness.controller.cancelReveal();
			expect(harness.writes).toEqual([260]);
			expect(harness.pendingFrames()).toBe(0);
		}

		const settled = createHarness();
		settled.controller.readerLeft();
		settled.controller.stabilizeAnchor(() => 100);
		settled.controller.interruptForNativeInput("pending");
		expect(settled.writes).toEqual([]);
	});

	it("never re-applies a landed fold-anchor correction over unhandled reader movement", () => {
		for (const landed of ["frame", "resize", "input"] as const) {
			for (const next of ["native-input", "newer-change"] as const) {
				const harness = createHarness();
				harness.controller.readerLeft();
				harness.controller.stabilizeAnchor(() => 100);
				if (landed === "frame") harness.advance(16);
				else if (landed === "resize") harness.controller.refreshAnchor();
				const resume = harness.controller.interruptForNativeInput("pending");
				harness.setGeometry({ scrollTop: 220 });
				const writesBeforeResume = harness.writes.length;
				resume();
				if (next === "native-input") harness.controller.interruptForNativeInput("pending");
				else harness.controller.cancelReveal();
				expect(harness.writes).toHaveLength(writesBeforeResume);
				expect(harness.readGeometry().scrollTop).toBe(220);
			}
		}
	});

	it("counts a fold-anchor correction as landed once its first frame or the resize backstop wrote it", () => {
		for (const landed of ["frame", "resize"] as const) {
			const harness = createHarness();
			harness.controller.readerLeft();
			harness.controller.stabilizeAnchor(() => 100);
			if (landed === "frame") harness.advance(16);
			else harness.controller.refreshAnchor();
			harness.setGeometry({ scrollTop: 220 });
			const writesBeforeInput = harness.writes.length;
			harness.controller.interruptForNativeInput("pending");
			expect(harness.writes).toHaveLength(writesBeforeInput);
			expect(harness.readGeometry().scrollTop).toBe(220);
		}
	});

	it("lets a reveal supersede fold-anchor stabilization through the shared owner", () => {
		const harness = createHarness();
		harness.controller.readerLeft();
		harness.controller.stabilizeAnchor(() => 300);
		harness.controller.revealTo(() => 700, false);
		harness.advance(220);
		expect(harness.writes.at(-1)).toBe(700);
		expect(harness.pendingFrames()).toBe(0);
	});

	it("cancels only the active automatic reveal when the user takes over", () => {
		const harness = createHarness();
		harness.controller.revealTo(() => 700, true);
		expect(harness.pendingFrames()).toBe(1);
		harness.controller.cancelReveal();
		expect(harness.pendingFrames()).toBe(0);
		expect(harness.controller.getSnapshot().following).toBe(true);
	});

	it("does not cancel a settlement return when a non-scrolling pointer only cancels reveals", () => {
		const harness = createHarness({ latestEdge: "bottom" });
		harness.setGeometry({ scrollTop: 300, maxScrollTop: 900 });
		harness.controller.settle();
		harness.controller.cancelReveal();
		expect(harness.pendingFrames()).toBe(1);
		harness.advance(220);
		expect(harness.writes.at(-1)).toBe(900);
	});

	it("does not re-arm from geometry alone, but edge return and Follow response do", () => {
		const harness = createHarness({ reducedMotion: true });
		harness.controller.readerLeft();
		harness.setGeometry({ scrollTop: 100, edgeBottom: 750 });
		harness.controller.contentChanged();
		expect(harness.controller.getSnapshot().following).toBe(false);
		expect(harness.writes).toEqual([]);

		harness.controller.readerReachedEdge();
		expect(harness.controller.getSnapshot().following).toBe(true);
		expect(harness.writes.at(-1)).toBe(250);

		harness.controller.readerLeft();
		harness.setGeometry({ edgeBottom: 700 });
		harness.controller.returnToEdge();
		expect(harness.writes.at(-1)).toBe(350);
		expect(harness.controller.getSnapshot().following).toBe(true);
	});

	it("uses the physical latest edge for Latest after settlement", () => {
		const harness = createHarness({
			streaming: false,
			latestEdge: "top",
			geometryAvailable: false,
		});
		harness.controller.readerLeft();
		harness.setGeometry({ scrollTop: 300, maxScrollTop: 900 });
		harness.controller.returnToEdge();
		expect(harness.writes).toEqual([]);
		harness.advance(220);
		expect(harness.writes.at(-1)).toBe(0);
	});

	it("settles a following reader at the physical latest edge in both orders", () => {
		for (const latestEdge of ["bottom", "top"] as const) {
			const harness = createHarness({ latestEdge });
			harness.setGeometry({ scrollTop: 300, maxScrollTop: 900, edgeBottom: 500 });
			harness.controller.setStreaming(false);
			harness.advance(220);

			expect(harness.controller.getSnapshot()).toMatchObject({
				following: true,
				moving: true,
				runway: false,
				buttonLabel: null,
			});
			expect(harness.writes.at(-1)).toBe(latestEdge === "bottom" ? 900 : 0);
			for (let frame = 0; frame < 30; frame += 1) harness.advance(16);
			expect(harness.controller.getSnapshot().moving).toBe(false);
		}
	});

	it("keeps the settlement return when another run is already active", () => {
		const harness = createHarness({ latestEdge: "bottom" });
		harness.setGeometry({ scrollTop: 300, maxScrollTop: 900, edgeBottom: 500 });
		harness.controller.settle();
		harness.controller.setStreaming(true);
		expect(harness.pendingFrames()).toBe(1);
		harness.advance(220);
		expect(harness.writes.at(-1)).toBe(900);
		expect(harness.controller.getSnapshot()).toMatchObject({
			following: true,
			runway: true,
			buttonLabel: null,
		});
	});

	it("defers a queued user-row anchor until settlement cleanup completes", () => {
		const harness = createHarness({ latestEdge: "top" });
		harness.setGeometry({
			scrollTop: 100,
			maxScrollTop: 100,
			edgeBottom: 601,
		});
		harness.controller.contentChanged();
		harness.advance(220);
		harness.controller.settle();
		harness.controller.setStreaming(true);
		harness.controller.userTurnArrived(5, "queued");
		expect(harness.anchors).toEqual([]);
		harness.advance(220);
		expect(harness.runwayHeights.at(-1)).toBe(0);
		for (let frame = 0; frame < 30; frame += 1) harness.advance(16);
		harness.advance(0);
		expect(harness.anchors).toEqual([{ index: 5, inset: 60 }]);
	});

	it("does not let a newest row replace settlement cleanup", () => {
		const harness = createHarness({ latestEdge: "top" });
		harness.setGeometry({
			scrollTop: 100,
			maxScrollTop: 100,
			edgeBottom: 601,
		});
		harness.controller.contentChanged();
		harness.advance(220);
		harness.controller.settle();
		harness.controller.setStreaming(true);
		harness.controller.latestRowArrived(0);
		harness.advance(220);
		expect(harness.runwayHeights.at(-1)).toBe(0);
	});

	it("retargets one settlement return when the physical latest edge changes", () => {
		const harness = createHarness({ latestEdge: "bottom" });
		harness.setGeometry({ scrollTop: 300, maxScrollTop: 900, edgeBottom: 500 });
		harness.controller.setStreaming(false);
		expect(harness.pendingFrames()).toBe(1);
		harness.advance(100);
		harness.setGeometry({ maxScrollTop: 1_400 });
		harness.controller.contentChanged();
		expect(harness.pendingFrames()).toBe(1);
		harness.advance(120);
		expect(harness.writes.at(-1)).toBe(1_400);
	});

	it("settles runway and scroll through one motion channel", () => {
		const harness = createHarness({ latestEdge: "top" });
		harness.setGeometry({
			scrollTop: 100,
			maxScrollTop: 100,
			edgeBottom: 601,
		});
		harness.controller.contentChanged();
		advanceUntilIdle(harness);
		harness.controller.settle();
		expect(harness.pendingFrames()).toBe(1);
	});

	it("finishes partial settlement runway cleanup on either idle reattach path", () => {
		for (const reattach of ["return", "edge"] as const) {
			const harness = createHarness();
			harness.setGeometry({
				scrollTop: 100,
				maxScrollTop: 100,
				edgeBottom: 601,
			});
			harness.controller.contentChanged();
			harness.advance(220);
			harness.controller.setStreaming(false);
			harness.advance(110);
			expect(harness.runwayHeights.at(-1)).toBeGreaterThan(0);

			harness.controller.readerLeft();
			if (reattach === "return") harness.controller.returnToEdge();
			else harness.controller.readerReachedEdge();
			harness.advance(220);

			expect(harness.runwayHeights.at(-1)).toBe(0);
			expect(harness.controller.getSnapshot()).toMatchObject({
				following: true,
				runway: false,
			});
		}
	});

	it("follows idle disclosure geometry after settlement suppression ends", () => {
		const harness = createHarness({ streaming: true, reducedMotion: true });
		harness.setGeometry({ scrollTop: 300, maxScrollTop: 900 });
		harness.controller.settle();
		expect(harness.writes.at(-1)).toBe(900);
		harness.setGeometry({ scrollTop: 900, maxScrollTop: 1_200 });
		harness.controller.contentChanged();
		expect(harness.writes.at(-1)).toBe(1_200);
	});

	it("retains immediate settlement corrections under reduced motion", () => {
		const harness = createHarness({ streaming: true, reducedMotion: true });
		harness.setGeometry({ scrollTop: 300, maxScrollTop: 900 });
		harness.controller.settle();
		expect(harness.writes.at(-1)).toBe(900);
		expect(harness.pendingFrames()).toBe(1);
		harness.setGeometry({ maxScrollTop: 1_400 });
		harness.advance(16);
		expect(harness.writes.at(-1)).toBe(1_400);
		for (let frame = 0; frame < 29; frame += 1) harness.advance(16);
		expect(harness.pendingFrames()).toBe(0);
	});

	it("retargets a settled Latest return through delayed measurement", () => {
		const harness = createHarness({ streaming: false });
		harness.controller.readerLeft();
		harness.setGeometry({ scrollTop: 300, maxScrollTop: 900 });
		harness.controller.returnToEdge();
		expect(harness.writes).toEqual([]);
		harness.advance(220);
		expect(harness.writes.at(-1)).toBe(900);
		for (let frame = 0; frame < 10; frame += 1) harness.advance(16);
		harness.setGeometry({ maxScrollTop: 1_400 });
		harness.advance(16);
		harness.advance(220);
		expect(harness.writes.at(-1)).toBe(1_400);
		for (let frame = 0; frame < 20; frame += 1) harness.advance(16);
		expect(harness.pendingFrames()).toBe(0);
	});

	it("places a mount only once its first row is mounted", () => {
		const harness = createHarness({ latestEdge: "top", mountPending: true });
		harness.setGeometry({ scrollTop: 200, maxScrollTop: 900, edgeBottom: 750 });
		harness.controller.contentChanged();
		expect(harness.writes).toEqual([]);
		harness.setReferenceRow({ id: "r1", top: 0 });
		harness.controller.contentChanged();
		harness.controller.contentChanged();
		expect(harness.writes.length).toBeGreaterThan(0);
		expect(harness.writes.every((write) => write === 350)).toBe(true);
		expect(harness.controller.getSnapshot().runway).toBe(true);
	});

	it("holds a streaming mount at the pin line through measurement without animation", () => {
		const harness = createHarness({ mountPending: true });
		harness.setReferenceRow({ id: "r1", top: 0 });
		harness.setGeometry({ scrollTop: 200, maxScrollTop: 900, edgeBottom: 750 });
		harness.controller.contentChanged();
		expect(harness.writes).toEqual([350]);
		expect(harness.controller.getMotionKind()).toBe("mount");
		harness.setGeometry({ edgeBottom: 730, maxScrollTop: 1_030 });
		harness.advance(16);
		expect(harness.writes.at(-1)).toBe(480);
		expect(harness.readGeometry().edgeBottom).toBe(600);
		harness.setGeometry({ edgeBottom: 640, maxScrollTop: 1_070 });
		harness.controller.contentChanged();
		expect(harness.writes.at(-1)).toBe(520);
		expect(
			harness.writes.every((write, index) => index === 0 || write >= harness.writes[index - 1]),
		).toBe(true);
		advanceUntilIdle(harness);
		expect(harness.controller.getMotionKind()).toBeNull();
		expect(harness.readGeometry().edgeBottom).toBe(600);
	});

	it("holds a streaming mount at the pin line when measurement pushes the edge below the fold", () => {
		const harness = createHarness({ mountPending: true });
		harness.setReferenceRow({ id: "r1", top: 0 });
		harness.setGeometry({ scrollTop: 200, maxScrollTop: 900, edgeBottom: 750 });
		harness.controller.contentChanged();
		expect(harness.writes).toEqual([350]);
		harness.setGeometry({ edgeBottom: 1_050, maxScrollTop: 1_400 });
		harness.advance(16);
		expect(harness.writes.at(-1)).toBe(800);
		expect(harness.readGeometry().edgeBottom).toBe(600);
	});

	it("lets a controller reveal that starts first own a pending mount", () => {
		for (const start of ["reveal", "anchor"] as const) {
			const harness = createHarness({ streaming: false, mountPending: true });
			harness.setReferenceRow({ id: "r1", top: 0 });
			if (start === "reveal") harness.controller.revealTo(() => 300, true);
			else harness.controller.stabilizeAnchor(() => 300);
			harness.controller.contentChanged();
			expect(harness.controller.getMotionKind()).toBe(start);
			advanceUntilIdle(harness);
			expect(harness.writes).not.toContain(1_000);
		}
	});

	it("cancels the streaming mount hold on reader takeover or a new turn", () => {
		for (const takeover of ["reader", "turn"] as const) {
			const harness = createHarness({ mountPending: true });
			harness.setReferenceRow({ id: "r1", top: 0 });
			harness.setGeometry({ scrollTop: 200, maxScrollTop: 900, edgeBottom: 600 });
			harness.controller.contentChanged();
			expect(harness.controller.getMotionKind()).toBe("mount");
			if (takeover === "reader") harness.controller.readerLeft();
			else harness.controller.armImmediateTurn();
			expect(harness.controller.getMotionKind()).toBeNull();
			const writes = harness.writes.length;
			harness.setGeometry({ edgeBottom: 700, maxScrollTop: 1_100 });
			harness.advance(16);
			expect(harness.writes.length).toBe(writes);
		}
	});

	it("places an idle oldest-first mount at the bottom without animation", () => {
		const harness = createHarness({ streaming: false, mountPending: true });
		harness.setReferenceRow({ id: "r1", top: 0 });
		harness.controller.contentChanged();
		expect(harness.writes).toEqual([1_000]);
		harness.setGeometry({ maxScrollTop: 1_400 });
		harness.advance(16);
		expect(harness.writes.at(-1)).toBe(1_400);
		advanceUntilIdle(harness);
		expect(harness.controller.getSnapshot().runway).toBe(false);
	});

	it("leaves an idle newest-first mount at the native zero origin", () => {
		const harness = createHarness({ streaming: false, latestEdge: "top", mountPending: true });
		harness.setGeometry({ scrollTop: 0 });
		harness.setReferenceRow({ id: "r1", top: 0 });
		harness.controller.contentChanged();
		expect(harness.writes).toEqual([]);
		expect(harness.pendingFrames()).toBe(0);
	});

	it("places at the pin line when the stream starts before the first row mounts", () => {
		const harness = createHarness({ streaming: false, mountPending: true });
		harness.setGeometry({ scrollTop: 200, maxScrollTop: 900, edgeBottom: 750 });
		harness.controller.contentChanged();
		harness.controller.setStreaming(true);
		harness.setReferenceRow({ id: "r1", top: 0 });
		harness.controller.contentChanged();
		expect(harness.writes[0]).toBe(350);
	});

	it("does not mistake a newly started turn for an active-stream remount", () => {
		const harness = createHarness({ streaming: false, mountPending: true });
		harness.controller.armImmediateTurn();
		harness.controller.setStreaming(true);
		harness.setGeometry({ scrollTop: 200, maxScrollTop: 900, edgeBottom: 600 });
		harness.setReferenceRow({ id: "r1", top: 0 });
		harness.controller.contentChanged();
		expect(harness.writes).toEqual([]);
	});

	it("yields a pending mount to a reader who already took over", () => {
		const harness = createHarness({ streaming: false, mountPending: true });
		harness.controller.readerLeft();
		harness.setReferenceRow({ id: "r1", top: 0 });
		harness.controller.contentChanged();
		expect(harness.writes).toEqual([]);
	});

	it("moves a stream that starts during the idle mount hold to the pin line", () => {
		const harness = createHarness({ streaming: false, mountPending: true });
		harness.setReferenceRow({ id: "r1", top: 0 });
		harness.controller.contentChanged();
		expect(harness.controller.getMotionKind()).toBe("mount");
		harness.setGeometry({ scrollTop: 1_000, maxScrollTop: 1_000, edgeBottom: 750 });
		harness.controller.setStreaming(true);
		harness.controller.contentChanged();
		expect(harness.controller.getMotionKind()).toBe("mount");
		expect(harness.writes).toEqual([1_000, 1_150]);
		expect(harness.readRunwayHeight()).toBe(150);
		harness.advance(16);
		expect(harness.writes.at(-1)).toBe(1_150);
	});

	it("defers mount placement past native input, then places without animation", () => {
		const harness = createHarness({ streaming: false, mountPending: true });
		harness.setReferenceRow({ id: "r1", top: 0 });
		const resume = harness.controller.interruptForNativeInput();
		harness.controller.contentChanged();
		expect(harness.writes).toEqual([]);
		resume();
		expect(harness.writes).toEqual([1_000]);
		advanceUntilIdle(harness);
		expect(harness.writes.every((write) => write === 1_000)).toBe(true);
	});

	it("keeps a streaming mount pending until the stream edge exists", () => {
		const harness = createHarness({ mountPending: true });
		harness.setReferenceRow({ id: "r1", top: 0 });
		harness.setGeometry({ scrollTop: 200, maxScrollTop: 900, edgeBottom: null });
		harness.controller.contentChanged();
		expect(harness.writes).toEqual([]);
		expect(harness.pendingFrames()).toBe(0);
		harness.setGeometry({ edgeBottom: 750 });
		harness.controller.contentChanged();
		expect(harness.writes).toEqual([350]);
		advanceUntilIdle(harness);
		expect(harness.writes.every((write) => write === 350)).toBe(true);
	});

	it("reconstructs at the pin line after message order switches during a stream", () => {
		const harness = createHarness({ mountPending: true });
		harness.setReferenceRow({ id: "r1", top: 0 });
		harness.setGeometry({ scrollTop: 200, maxScrollTop: 900, edgeBottom: 750 });
		harness.controller.contentChanged();
		harness.controller.setLatestEdge("top");
		harness.setGeometry({ scrollTop: 300, maxScrollTop: 900, edgeBottom: 750 });
		harness.controller.contentChanged();
		expect(harness.writes).toEqual([350, 450]);
	});
});

describe("reading-band derived room", () => {
	it("stays still while the response fills below the pin line", () => {
		const harness = createHarness();
		harness.setGeometry({ scrollTop: 100, maxScrollTop: 100, edgeBottom: 599 });
		harness.controller.contentChanged();
		expect(harness.writes).toEqual([]);
		expect(harness.runwayHeights).toEqual([]);
		expect(harness.pendingFrames()).toBe(0);
	});

	it("holds the edge on the pin line after each growth in the same callback", () => {
		const harness = createHarness();
		harness.setGeometry({ scrollTop: 100, maxScrollTop: 100, edgeBottom: 601 });
		harness.controller.contentChanged();
		expect(harness.runwayHeights).toEqual([1]);
		expect(harness.writes).toEqual([101]);
		expect(harness.readGeometry()).toMatchObject({
			scrollTop: 101,
			maxScrollTop: 101,
			edgeBottom: 600,
		});
		for (let update = 1; update <= 5; update += 1) {
			grow(harness, 40);
			expect(harness.readGeometry()).toMatchObject({
				scrollTop: 101 + update * 40,
				edgeBottom: 600,
			});
			expect(harness.pendingFrames()).toBe(0);
			expect(harness.controller.getMotionKind()).toBeNull();
		}
		expect(harness.runwayHeights).toEqual([1]);
	});

	it("publishes no state while the pin follows growth", () => {
		const harness = createHarness();
		startPinned(harness);
		const published = harness.stateChanges();
		const snapshot = harness.controller.getSnapshot();
		for (let update = 0; update < 10; update += 1) grow(harness, 25);
		expect(harness.stateChanges()).toBe(published);
		expect(harness.controller.getSnapshot()).toEqual(snapshot);
		expect(harness.readGeometry().edgeBottom).toBe(600);
	});

	it("retargets Follow response for growth during its eased move without overshooting", () => {
		const harness = createHarness();
		harness.controller.readerLeft();
		harness.setGeometry({ scrollTop: 100, maxScrollTop: 100, edgeBottom: 751 });
		harness.controller.returnToEdge();
		harness.advance(64);
		const beforeGrowth = harness.readGeometry();
		harness.setGeometry({
			edgeBottom: (beforeGrowth.edgeBottom ?? 0) + 100,
			maxScrollTop: beforeGrowth.maxScrollTop + 100,
		});
		const finalTarget =
			harness.readGeometry().scrollTop + (harness.readGeometry().edgeBottom ?? 0) - 600;
		harness.controller.contentChanged();
		advanceUntilIdle(harness);
		expect(harness.writes.every((write) => write <= finalTarget)).toBe(true);
		expect(harness.readGeometry().scrollTop).toBe(finalTarget);
		expect(harness.readGeometry().edgeBottom).toBe(600);
	});

	it("never rolls Follow response back when content shrinks under it", () => {
		const harness = createHarness();
		harness.controller.readerLeft();
		harness.setGeometry({ scrollTop: 100, maxScrollTop: 100, edgeBottom: 900 });
		harness.controller.returnToEdge();
		harness.advance(150);
		const midMove = harness.readGeometry();
		harness.setGeometry({
			edgeBottom: (midMove.edgeBottom ?? 0) - 60,
			maxScrollTop: midMove.maxScrollTop - 60,
		});
		const writesBefore = harness.writes.length;
		advanceUntilIdle(harness);
		const later = harness.writes.slice(writesBefore);
		for (const [index, write] of later.entries()) {
			const previous = index === 0 ? midMove.scrollTop : (later[index - 1] ?? 0);
			expect(write).toBeGreaterThanOrEqual(previous - 0.5);
		}
	});

	it("does not recurse when the pin target cannot be reached", () => {
		const harness = createHarness({ runwayWritable: false });
		harness.setGeometry({ scrollTop: 100, maxScrollTop: 100, edgeBottom: 601 });
		harness.controller.contentChanged();
		harness.controller.contentChanged();
		expect(harness.pendingFrames()).toBe(0);
		expect(harness.readGeometry().scrollTop).toBe(100);
		expect(harness.controller.getMotionKind()).toBeNull();
	});

	it("absorbs a shrink while pinned in room, then consumes the room before pinning again", () => {
		const harness = createHarness();
		startPinned(harness);
		harness.setGeometry({ edgeBottom: 540, maxScrollTop: 41 });
		harness.controller.restoreScrollTop(101);
		harness.controller.contentChanged();
		expect(harness.readGeometry()).toMatchObject({
			scrollTop: 101,
			maxScrollTop: 101,
			edgeBottom: 540,
		});
		expect(harness.readRunwayHeight()).toBe(61);
		const writes = [...harness.writes];

		grow(harness, 40);
		expect(harness.writes).toEqual(writes);
		expect(harness.readGeometry().scrollTop).toBe(101);
		expect(harness.readRunwayHeight()).toBe(21);

		grow(harness, 40);
		expect(harness.readGeometry()).toMatchObject({ scrollTop: 121, edgeBottom: 600 });
		expect(harness.readRunwayHeight()).toBe(1);
		expect(
			harness.writes.every((write, index) => index === 0 || write >= harness.writes[index - 1]),
		).toBe(true);
	});

	it("uses a custom pin line in either message order", () => {
		for (const latestEdge of ["bottom", "top"] as const) {
			const harness = createHarness({ latestEdge, movement: { trigger: 90 } });
			harness.setGeometry({ scrollTop: 100, maxScrollTop: 100, edgeBottom: 691 });
			harness.controller.contentChanged();
			expect(harness.runwayHeights).toEqual([151]);
			expect(harness.writes.at(-1)).toBe(251);
			expect(harness.readGeometry().edgeBottom).toBe(540);
		}
	});

	it("restarts the fill phase after a new user turn", () => {
		const harness = createHarness();
		harness.setGeometry({ scrollTop: 100, maxScrollTop: 100, edgeBottom: 601 });
		harness.controller.contentChanged();
		advanceUntilIdle(harness);
		harness.controller.userTurnArrived(4, "queued");
		harness.advance(0);
		const writes = harness.writes.length;
		harness.setGeometry({ edgeBottom: 500, maxScrollTop: 301 });
		harness.controller.contentChanged();
		expect(harness.pendingFrames()).toBe(0);
		expect(harness.writes).toHaveLength(writes);
	});

	it("preserves room on reader takeover and only reconciles it downward after movement", () => {
		const harness = createHarness({ reducedMotion: true });
		harness.setGeometry({ scrollTop: 100, maxScrollTop: 100, edgeBottom: 751 });
		harness.controller.contentChanged();
		const writes = [...harness.writes];
		harness.controller.readerLeft();
		expect(harness.writes).toEqual(writes);
		expect(harness.readGeometry().scrollTop).toBe(251);
		expect(harness.runwayHeights).toEqual([151]);
		expect(harness.controller.getSnapshot()).toMatchObject({
			following: false,
			runway: true,
			buttonLabel: "Follow response",
		});

		harness.setGeometry({ scrollTop: 150, edgeBottom: 701 });
		harness.controller.reconcileRoom();
		expect(harness.readGeometry().scrollTop).toBe(150);
		expect(harness.runwayHeights.at(-1)).toBe(50);
		expect(harness.writes).toEqual(writes);
		harness.setGeometry({ maxScrollTop: 170, edgeBottom: 721 });
		harness.controller.contentChanged();
		expect(harness.runwayHeights.at(-1)).toBe(30);
		expect(
			harness.runwayHeights.every(
				(value, index, values) => index === 0 || value <= values[index - 1],
			),
		).toBe(true);
		expect(harness.writes).toEqual(writes);
	});

	it("settles a detached reader without scrolling and retains only reader-preserving room", () => {
		const harness = createHarness({ reducedMotion: true });
		harness.setGeometry({ scrollTop: 100, maxScrollTop: 100, edgeBottom: 751 });
		harness.controller.contentChanged();
		harness.controller.readerLeft();
		harness.setGeometry({ scrollTop: 150, edgeBottom: 701 });
		harness.controller.reconcileRoom();
		const writes = [...harness.writes];
		harness.controller.settle();
		expect(harness.writes).toEqual(writes);
		expect(harness.runwayHeights.at(-1)).toBe(50);
		expect(harness.controller.getSnapshot()).toEqual({
			following: false,
			moving: false,
			runway: true,
			buttonLabel: "Latest",
		});
	});

	it("settles a newest-first following reader to its top latest edge and removes room", () => {
		const harness = createHarness({ latestEdge: "top" });
		harness.setGeometry({ scrollTop: 100, maxScrollTop: 100, edgeBottom: 601 });
		harness.controller.contentChanged();
		advanceUntilIdle(harness);
		harness.controller.settle();
		advanceUntilIdle(harness);
		expect(harness.runwayHeights.at(-1)).toBe(0);
		expect(harness.readGeometry().scrollTop).toBe(0);
		expect(harness.controller.getSnapshot()).toMatchObject({
			following: true,
			moving: false,
			runway: false,
		});
	});

	it("keeps an oldest-first following reader still at settlement and preserves its room", () => {
		const harness = createHarness();
		harness.setGeometry({ scrollTop: 100, maxScrollTop: 100, edgeBottom: 601 });
		harness.controller.contentChanged();
		advanceUntilIdle(harness);
		const scrollTop = harness.readGeometry().scrollTop;
		const room = harness.runwayHeights.at(-1);
		const writes = [...harness.writes];
		harness.controller.settle();
		advanceUntilIdle(harness);
		expect(harness.writes).toEqual(writes);
		expect(harness.readGeometry().scrollTop).toBe(scrollTop);
		expect(harness.runwayHeights.at(-1)).toBe(room);
		expect(harness.controller.getSnapshot()).toMatchObject({
			following: true,
			moving: false,
			buttonLabel: null,
		});
	});

	it("moves an oldest-first following reader forward at settlement only for unseen content", () => {
		const harness = createHarness();
		harness.setGeometry({ scrollTop: 100, maxScrollTop: 400, edgeBottom: 500 });
		harness.controller.settle();
		advanceUntilIdle(harness);
		expect(harness.readGeometry().scrollTop).toBe(400);
		expect(harness.controller.getSnapshot()).toMatchObject({ following: true, moving: false });
	});

	it("defers a following settlement return until pending native input resolves", () => {
		const harness = createHarness({ latestEdge: "top" });
		harness.setGeometry({ scrollTop: 100, maxScrollTop: 100, edgeBottom: 601 });
		harness.controller.contentChanged();
		advanceUntilIdle(harness);
		const resume = harness.controller.interruptForNativeInput("pending");
		const writes = [...harness.writes];
		harness.controller.settle();
		harness.advance(16);
		expect(harness.writes).toEqual(writes);
		expect(harness.pendingFrames()).toBe(0);

		resume();
		advanceUntilIdle(harness);
		expect(harness.runwayHeights.at(-1)).toBe(0);
		expect(harness.readGeometry().scrollTop).toBe(0);
		expect(harness.controller.getSnapshot()).toMatchObject({ following: true, moving: false });
	});

	it("drops a deferred settlement return when the pending input detaches the reader", () => {
		const harness = createHarness();
		harness.setGeometry({ scrollTop: 100, maxScrollTop: 100, edgeBottom: 601 });
		harness.controller.contentChanged();
		advanceUntilIdle(harness);
		const resume = harness.controller.interruptForNativeInput("pending");
		harness.controller.settle();
		harness.setGeometry({ scrollTop: 180 });
		harness.controller.readerLeft();
		const writes = [...harness.writes];
		resume();
		advanceUntilIdle(harness);
		expect(harness.writes).toEqual(writes);
		expect(harness.readGeometry().scrollTop).toBe(180);
		expect(harness.controller.getSnapshot()).toMatchObject({
			following: false,
			buttonLabel: "Latest",
		});
	});

	it("re-derives Follow response room on a content notification while moving", () => {
		const harness = createHarness();
		harness.controller.readerLeft();
		harness.setGeometry({ scrollTop: 100, maxScrollTop: 100, edgeBottom: 751 });
		harness.controller.returnToEdge();
		expect(harness.runwayHeights).toEqual([151]);
		harness.advance(16);
		expect(harness.controller.getSnapshot().moving).toBe(true);
		harness.setGeometry({ viewportHeight: 400 });
		harness.controller.contentChanged();
		expect(harness.runwayHeights.length).toBe(2);
		expect(harness.runwayHeights.at(-1)).not.toBe(151);
	});

	it("keeps a suppressed runway inactive through later content changes", () => {
		const harness = createHarness();
		harness.setGeometry({ scrollTop: 100, maxScrollTop: 100, edgeBottom: 400 });
		harness.controller.contentChanged();
		harness.controller.releaseRunway();
		expect(harness.controller.getSnapshot().runway).toBe(false);
		harness.setGeometry({ edgeBottom: 420 });
		harness.controller.contentChanged();
		expect(harness.controller.getSnapshot()).toMatchObject({ following: true, runway: false });
	});

	it("defers row arrivals during pending native input and places them after it resolves", () => {
		const harness = createHarness({ latestEdge: "top" });
		harness.setGeometry({ scrollTop: 120, maxScrollTop: 1_000, edgeBottom: 400 });
		const resume = harness.controller.interruptForNativeInput("pending");
		harness.controller.latestRowArrived(0);
		harness.controller.userTurnArrived(4, "queued");
		harness.advance(16);
		expect(harness.writes).toEqual([]);
		expect(harness.anchors).toEqual([]);

		resume();
		harness.advance(16);
		expect(harness.anchors).toEqual([{ index: 4, inset: 60 }]);
	});

	it("completes a deferred settlement before anchoring a queued turn that arrived during input", () => {
		const harness = createHarness({ latestEdge: "top" });
		harness.setGeometry({ scrollTop: 100, maxScrollTop: 100, edgeBottom: 601 });
		harness.controller.contentChanged();
		advanceUntilIdle(harness);
		const resume = harness.controller.interruptForNativeInput("pending");
		harness.controller.settle();
		harness.controller.userTurnArrived(7, "queued");
		harness.advance(16);
		expect(harness.anchors).toEqual([]);

		resume();
		advanceUntilIdle(harness);
		expect(harness.runwayHeights.at(-1)).toBe(0);
		expect(harness.anchors).toEqual([{ index: 7, inset: 60 }]);
	});

	it("resumes a paused reveal when a row that cannot apply arrives during pending input", () => {
		const harness = createHarness({ streaming: false });
		harness.setGeometry({ scrollTop: 500, maxScrollTop: 1_000 });
		harness.controller.readerLeft();
		harness.controller.revealTo(() => 300, false);
		harness.advance(16);
		const resume = harness.controller.interruptForNativeInput("pending");
		harness.controller.userTurnArrived(3, "queued");
		resume();
		advanceUntilIdle(harness);
		expect(harness.readGeometry().scrollTop).toBe(300);
		expect(harness.anchors).toEqual([]);
		expect(harness.controller.getSnapshot()).toMatchObject({ following: false, moving: false });
	});

	it("does not strand moving when a deferred newest row finds the reader already at the top", () => {
		const harness = createHarness({ latestEdge: "top", streaming: false });
		harness.setGeometry({ scrollTop: 0, maxScrollTop: 1_000 });
		harness.controller.revealTo(() => 200, false);
		harness.advance(16);
		const resume = harness.controller.interruptForNativeInput("pending");
		harness.setGeometry({ scrollTop: 0 });
		harness.controller.latestRowArrived(0);
		resume();
		advanceUntilIdle(harness);
		expect(harness.controller.getSnapshot().moving).toBe(false);
	});

	it("a queued turn in the same run clears an earlier reveal's suppression", () => {
		const harness = createHarness({ reducedMotion: true });
		harness.setGeometry({ scrollTop: 100, maxScrollTop: 100, edgeBottom: 400 });
		harness.controller.releaseRunway();
		harness.controller.userTurnArrived(5, "queued");
		harness.advance(0);
		expect(harness.controller.getSnapshot().runway).toBe(true);
		harness.setGeometry({ edgeBottom: 751 });
		harness.controller.contentChanged();
		expect(harness.readGeometry().scrollTop).toBe(251);
	});

	it("Follow response eases once to the pin line, then the pin holds the edge", () => {
		const harness = createHarness();
		harness.controller.readerLeft();
		harness.setGeometry({ scrollTop: 100, maxScrollTop: 100, edgeBottom: 751 });
		harness.controller.returnToEdge();
		expect(harness.controller.getMotionKind()).toBe("follow");
		harness.advance(16);
		expect(harness.writes.at(-1)).toBeGreaterThan(100);
		expect(harness.writes.at(-1)).toBeLessThan(251);
		advanceUntilIdle(harness);
		expect(harness.readGeometry().scrollTop).toBeCloseTo(251, 8);
		expect(harness.readGeometry().edgeBottom).toBeCloseTo(600, 8);
		expect(harness.controller.getMotionKind()).toBeNull();

		grow(harness, 40);
		expect(harness.readGeometry().scrollTop).toBeCloseTo(291, 8);
		expect(harness.readGeometry().edgeBottom).toBeCloseTo(600, 8);
		expect(harness.pendingFrames()).toBe(0);
	});

	it("does not reschedule a pin or recurse through contentChanged", () => {
		const harness = createHarness();
		harness.setGeometry({ scrollTop: 100, maxScrollTop: 100, edgeBottom: 601 });
		harness.controller.contentChanged();
		advanceUntilIdle(harness);
		const writes = [...harness.writes];
		harness.controller.contentChanged();
		expect(harness.pendingFrames()).toBe(0);
		expect(harness.writes).toEqual(writes);
	});

	it("pending native input blocks the pin until it resolves", () => {
		const harness = createHarness();
		startPinned(harness);
		const resume = harness.controller.interruptForNativeInput("pending");
		const writes = [...harness.writes];
		grow(harness, 40);
		expect(harness.pendingFrames()).toBe(0);
		expect(harness.writes).toEqual(writes);

		resume();
		advanceUntilIdle(harness);
		expect(harness.readGeometry().scrollTop).toBeCloseTo(141, 8);
		expect(harness.readGeometry().edgeBottom).toBeCloseTo(600, 8);
	});

	it("reader takeover releases pending native input so a later edge return follows", () => {
		const harness = createHarness();
		startPinned(harness);
		harness.controller.interruptForNativeInput("pending");
		harness.controller.readerLeft();
		harness.controller.readerReachedEdge();
		grow(harness, 60);
		advanceUntilIdle(harness);
		expect(harness.controller.getSnapshot().following).toBe(true);
		expect(harness.writes.at(-1)).toBeCloseTo(161, 8);
		expect(harness.readGeometry().edgeBottom).toBeCloseTo(600, 8);
	});

	it("an attention reveal removes room and suppresses it for the rest of that flow", () => {
		const harness = createHarness({ reducedMotion: true });
		harness.setGeometry({ scrollTop: 100, maxScrollTop: 100, edgeBottom: 601 });
		harness.controller.contentChanged();
		harness.controller.releaseRunway();
		expect(harness.runwayHeights.at(-1)).toBe(0);
		harness.setGeometry({ edgeBottom: 601 });
		harness.controller.contentChanged();
		expect(harness.runwayHeights.at(-1)).toBe(0);
		expect(harness.controller.getSnapshot().runway).toBe(false);
	});
});

describe("reading-band reveal resumption and tall arrivals", () => {
	it("resumes follow after a released reveal and ignores ineligible resume requests", () => {
		const harness = createHarness();
		startPinned(harness);
		harness.controller.releaseRunway();
		const writesAfterRelease = [...harness.writes];
		const geometry = harness.readGeometry();
		harness.setGeometry({
			edgeBottom: (geometry.edgeBottom ?? 0) + 100,
			maxScrollTop: geometry.maxScrollTop + 100,
		});
		harness.controller.contentChanged();
		expect(harness.writes).toEqual(writesAfterRelease);
		expect(harness.controller.getSnapshot()).toMatchObject({ following: true, runway: false });

		harness.controller.resumeAfterReveal();
		advanceUntilIdle(harness);
		const resumedGeometry = harness.readGeometry();
		expect(resumedGeometry.edgeBottom).toBeCloseTo(600, 8);

		const idle = createHarness({ streaming: false });
		idle.controller.releaseRunway();
		const idleState = idle.controller.getSnapshot();
		idle.controller.resumeAfterReveal();
		expect(idle.controller.getSnapshot()).toEqual(idleState);

		const unsuppressed = createHarness();
		const activeState = unsuppressed.controller.getSnapshot();
		unsuppressed.controller.resumeAfterReveal();
		expect(unsuppressed.controller.getSnapshot()).toEqual(activeState);
		expect(unsuppressed.pendingFrames()).toBe(0);
	});

	it("resumes following when a reveal still in flight completes", () => {
		const harness = createHarness();
		startPinned(harness);
		harness.controller.releaseRunway();
		const geometry = harness.readGeometry();
		harness.controller.revealTo(() => geometry.scrollTop - 200, true);
		harness.advance(16);
		expect(harness.controller.getMotionKind()).toBe("reveal");
		harness.setGeometry({
			edgeBottom: (harness.readGeometry().edgeBottom ?? 0) + 300,
			maxScrollTop: harness.readGeometry().maxScrollTop + 300,
		});
		harness.controller.resumeAfterReveal();
		advanceUntilIdle(harness);
		expect(harness.readGeometry().edgeBottom).toBeCloseTo(600, 8);
	});

	it("caps one tall arrival so its start lands at the turn inset", () => {
		const harness = createHarness();
		harness.setReferenceRow({ id: "r1", top: 100 });
		startPinned(harness);
		const before = harness.readGeometry();
		const previousEdgeDoc = before.scrollTop + (before.edgeBottom ?? 0);
		harness.setGeometry({
			edgeBottom: (before.edgeBottom ?? 0) + 1_500,
			maxScrollTop: before.maxScrollTop + 1_500,
		});
		harness.controller.contentChanged();
		advanceUntilIdle(harness);
		expect(harness.readGeometry().scrollTop).toBeCloseTo(previousEdgeDoc - 60, 8);
	});

	it("caps a tall block that arrives in chunks smaller than the reading space", () => {
		const harness = createHarness();
		harness.setReferenceRow({ id: "r1", top: 100 });
		startPinned(harness);
		const before = harness.readGeometry();
		const previousEdgeDoc = before.scrollTop + (before.edgeBottom ?? 0);
		for (let chunk = 0; chunk < 4; chunk += 1) {
			grow(harness, 350);
			harness.advance(16);
		}
		expect(harness.readGeometry().scrollTop).toBeCloseTo(previousEdgeDoc - 60, 8);
		expect(
			harness.writes.every((write, index) => index === 0 || write >= harness.writes[index - 1]),
		).toBe(true);
	});

	it("rebases the follow cap across width reflow before measuring the next growth", () => {
		const harness = createHarness();
		harness.setReferenceRow({ id: "r1", top: 100 });
		startPinned(harness);
		const before = harness.readGeometry();
		harness.controller.rebaseFollowCap();
		harness.setGeometry({
			edgeBottom: (before.edgeBottom ?? 0) + 1_500,
			maxScrollTop: before.maxScrollTop + 1_500,
		});
		harness.controller.contentChanged();
		advanceUntilIdle(harness);
		const expectedPin = before.scrollTop + (before.edgeBottom ?? 0) + 1_500 - before.viewportHeight;
		expect(harness.readGeometry().scrollTop).toBeCloseTo(expectedPin, 8);
	});

	it("keeps an existing cap after rebasing before small growth", () => {
		const harness = createHarness();
		harness.setReferenceRow({ id: "r1", top: 100 });
		startPinned(harness);
		const before = harness.readGeometry();
		const oldEdgeDoc = before.scrollTop + (before.edgeBottom ?? 0);
		harness.setGeometry({
			edgeBottom: (before.edgeBottom ?? 0) + 1_500,
			maxScrollTop: before.maxScrollTop + 1_500,
		});
		harness.controller.contentChanged();
		advanceUntilIdle(harness);
		const capped = harness.readGeometry();
		expect(capped.scrollTop).toBeCloseTo(oldEdgeDoc - 60, 8);

		harness.controller.rebaseFollowCap();
		harness.setGeometry({
			edgeBottom: (capped.edgeBottom ?? 0) + 100,
			maxScrollTop: capped.maxScrollTop + 100,
		});
		harness.controller.contentChanged();
		advanceUntilIdle(harness);
		const after = harness.readGeometry();
		const pinned = after.scrollTop + (after.edgeBottom ?? 0) - after.viewportHeight;
		expect(after.scrollTop).toBeCloseTo(capped.scrollTop, 8);
		expect(after.scrollTop).toBeLessThan(pinned);
	});

	it("does not cap an edge shift caused by content above the reference row", () => {
		const harness = createHarness();
		harness.setReferenceRow({ id: "r1", top: 100 });
		startPinned(harness);
		const before = harness.readGeometry();
		const previousEdgeDoc = before.scrollTop + (before.edgeBottom ?? 0);
		const expectedPinned = previousEdgeDoc + 600 - before.viewportHeight;
		harness.setGeometry({
			scrollTop: before.scrollTop + 600,
			maxScrollTop: before.maxScrollTop + 600,
		});
		harness.setReferenceRow({ id: "r1", top: 700 });
		harness.controller.contentChanged();
		advanceUntilIdle(harness);
		expect(harness.readGeometry().scrollTop).toBeCloseTo(expectedPinned, 8);
		harness.controller.settle();
		advanceUntilIdle(harness);
		expect(harness.controller.getSnapshot().following).toBe(true);
	});

	it("moves an active cap with its reference content", () => {
		const harness = createHarness();
		harness.setReferenceRow({ id: "r1", top: 100 });
		startPinned(harness);
		const before = harness.readGeometry();
		const previousEdgeDoc = before.scrollTop + (before.edgeBottom ?? 0);
		harness.setGeometry({
			edgeBottom: (before.edgeBottom ?? 0) + 1_500,
			maxScrollTop: before.maxScrollTop + 1_500,
		});
		harness.controller.contentChanged();
		advanceUntilIdle(harness);
		const cappedDestination = harness.readGeometry().scrollTop;
		expect(cappedDestination).toBeCloseTo(previousEdgeDoc - 60, 8);

		const capped = harness.readGeometry();
		harness.setGeometry({
			scrollTop: capped.scrollTop + 300,
			maxScrollTop: capped.maxScrollTop + 300,
		});
		harness.setReferenceRow({ id: "r1", top: 400 });
		harness.controller.contentChanged();
		advanceUntilIdle(harness);
		expect(harness.readGeometry().scrollTop).toBeCloseTo(cappedDestination + 300, 8);
	});

	it("caps an appended tall row at the previous edge relative to its reference row", () => {
		const harness = createHarness();
		harness.setReferenceRow({ id: "r1", top: 100 });
		startPinned(harness);
		const before = harness.readGeometry();
		const previousEdgeDoc = before.scrollTop + (before.edgeBottom ?? 0);
		harness.setGeometry({
			edgeBottom: (before.edgeBottom ?? 0) + 1_500,
			maxScrollTop: before.maxScrollTop + 1_500,
		});
		harness.setReferenceRow({ id: "r2", top: previousEdgeDoc });
		harness.controller.contentChanged();
		advanceUntilIdle(harness);
		expect(harness.readGeometry().scrollTop).toBeCloseTo(previousEdgeDoc - 60, 8);
	});

	it("keeps the cap alive when its original reference row unmounts after appending", () => {
		const harness = createHarness();
		harness.setReferenceRow({ id: "r1", top: 100 });
		startPinned(harness);
		const before = harness.readGeometry();
		const oldEdgeDoc = before.scrollTop + (before.edgeBottom ?? 0);
		harness.setGeometry({
			edgeBottom: (before.edgeBottom ?? 0) + 1_500,
			maxScrollTop: before.maxScrollTop + 1_500,
		});
		harness.controller.contentChanged();
		advanceUntilIdle(harness);
		expect(harness.readGeometry().scrollTop).toBeCloseTo(oldEdgeDoc - 60, 8);

		const beforeAppend = harness.readGeometry();
		const appendEdgeDoc = beforeAppend.scrollTop + (beforeAppend.edgeBottom ?? 0);
		harness.setGeometry({
			edgeBottom: (beforeAppend.edgeBottom ?? 0) + 30,
			maxScrollTop: beforeAppend.maxScrollTop + 30,
		});
		harness.setReferenceRow({ id: "r2", top: appendEdgeDoc });
		harness.controller.contentChanged();
		advanceUntilIdle(harness);
		const capped = harness.readGeometry();
		const cappedDestination = capped.scrollTop;

		harness.setRowTop("r1", null);
		harness.controller.contentChanged();
		advanceUntilIdle(harness);
		expect(harness.readGeometry().scrollTop).toBeCloseTo(cappedDestination, 8);
	});

	it("releases the cap when its active reference row is unmounted", () => {
		const harness = createHarness();
		harness.setReferenceRow({ id: "r1", top: 100 });
		startPinned(harness);
		const before = harness.readGeometry();
		const previousEdgeDoc = before.scrollTop + (before.edgeBottom ?? 0);
		harness.setGeometry({
			edgeBottom: (before.edgeBottom ?? 0) + 1_500,
			maxScrollTop: before.maxScrollTop + 1_500,
		});
		harness.controller.contentChanged();
		advanceUntilIdle(harness);
		expect(harness.readGeometry().scrollTop).toBeCloseTo(previousEdgeDoc - 60, 8);

		const capped = harness.readGeometry();
		const pinned = capped.scrollTop + (capped.edgeBottom ?? 0) - capped.viewportHeight;
		harness.setRowTop("r1", null);
		harness.setReferenceRow(null);
		expect(() => harness.controller.contentChanged()).not.toThrow();
		advanceUntilIdle(harness);
		expect(harness.readGeometry().scrollTop).toBeCloseTo(pinned, 8);
	});

	it("does not cap newest-first growth, where latest rows are prepended", () => {
		const harness = createHarness({ latestEdge: "top" });
		harness.setReferenceRow({ id: "r1", top: 100 });
		startPinned(harness);
		const before = harness.readGeometry();
		harness.setGeometry({
			edgeBottom: (before.edgeBottom ?? 0) + 1_500,
			maxScrollTop: before.maxScrollTop + 1_500,
		});
		harness.controller.contentChanged();
		advanceUntilIdle(harness);
		const after = harness.readGeometry();
		expect((after.edgeBottom ?? 0) / after.viewportHeight).toBeCloseTo(1, 2);
		harness.controller.settle();
		expect(harness.controller.getSnapshot().following).toBe(true);
	});

	it("releases a tall-arrival cap continuously at twice the later growth", () => {
		const harness = createHarness();
		harness.setReferenceRow({ id: "r1", top: 100 });
		startPinned(harness);
		const before = harness.readGeometry();
		const cappedDestination = before.scrollTop + (before.edgeBottom ?? 0) - 60;
		grow(harness, 1_500);
		expect(harness.readGeometry().scrollTop).toBe(cappedDestination);

		grow(harness, 50);
		expect(harness.readGeometry().scrollTop).toBe(cappedDestination);
		harness.advance(TALL_ARRIVAL_SETTLE_MS);

		grow(harness, 50);
		expect(harness.readGeometry().scrollTop).toBeCloseTo(cappedDestination + 100, 8);
		expect(harness.pendingFrames()).toBe(0);
		expect(harness.controller.getMotionKind()).toBeNull();
		grow(harness, 50);
		expect(harness.readGeometry().scrollTop).toBeCloseTo(cappedDestination + 200, 8);
		expect(harness.readGeometry().edgeBottom).toBeCloseTo(1_510, 8);
	});

	it("never moves backward when a cap destination is below the current scroll position", () => {
		const harness = createHarness();
		harness.setReferenceRow({ id: "r1", top: 100 });
		startPinned(harness);
		const before = harness.readGeometry();
		harness.setGeometry({
			edgeBottom: (before.edgeBottom ?? 0) + 1_500,
			maxScrollTop: before.maxScrollTop + 1_500,
		});
		harness.controller.contentChanged();
		advanceUntilIdle(harness);
		const capped = harness.readGeometry();
		const scrollTop = capped.scrollTop + 300;
		harness.setGeometry({
			scrollTop,
			edgeBottom: (capped.edgeBottom ?? 0) - 300,
		});
		const writeStart = harness.writes.length;
		harness.controller.contentChanged();
		advanceUntilIdle(harness);
		expect(harness.writes.slice(writeStart)).toEqual([]);

		const remount = createHarness({ mountPending: true });
		remount.setReferenceRow({ id: "r1", top: 0 });
		remount.setGeometry({ scrollTop: 500, maxScrollTop: 900, edgeBottom: 300 });
		remount.controller.contentChanged();
		advanceUntilIdle(remount);
		expect(remount.writes.length).toBeGreaterThan(0);
		expect(remount.writes.every((write) => write === 500)).toBe(true);
	});

	it("does not push an active cap for a second tall arrival", () => {
		const harness = createHarness();
		harness.setReferenceRow({ id: "r1", top: 100 });
		startPinned(harness);
		const before = harness.readGeometry();
		const oldEdgeDoc = before.scrollTop + (before.edgeBottom ?? 0);
		harness.setGeometry({
			edgeBottom: (before.edgeBottom ?? 0) + 1_500,
			maxScrollTop: before.maxScrollTop + 1_500,
		});
		harness.controller.contentChanged();
		advanceUntilIdle(harness);
		expect(harness.readGeometry().scrollTop).toBeCloseTo(oldEdgeDoc - 60, 8);

		const capped = harness.readGeometry();
		harness.setGeometry({
			edgeBottom: (capped.edgeBottom ?? 0) + 1_500,
			maxScrollTop: capped.maxScrollTop + 1_500,
		});
		harness.controller.contentChanged();
		advanceUntilIdle(harness);
		expect(harness.readGeometry().scrollTop).toBeCloseTo(oldEdgeDoc - 60, 8);
	});

	it("caps a tall arrival that crosses the pin line from the fill phase", () => {
		const harness = createHarness();
		harness.setReferenceRow({ id: "r1", top: 100 });
		harness.controller.contentChanged();
		const before = harness.readGeometry();
		const oldEdgeDoc = before.scrollTop + (before.edgeBottom ?? 0);
		harness.setGeometry({
			edgeBottom: (before.edgeBottom ?? 0) + 1_500,
			maxScrollTop: before.maxScrollTop + 1_500,
		});
		harness.controller.contentChanged();
		advanceUntilIdle(harness);
		expect(harness.readGeometry().scrollTop).toBeCloseTo(oldEdgeDoc - 60, 8);
	});

	it("settles normally with a cap when nothing is hidden below the reader", () => {
		const harness = createHarness();
		harness.setReferenceRow({ id: "r1", top: 100 });
		startPinned(harness);
		const before = harness.readGeometry();
		harness.setGeometry({
			edgeBottom: (before.edgeBottom ?? 0) + 1_500,
			maxScrollTop: before.maxScrollTop + 1_500,
		});
		harness.controller.contentChanged();
		advanceUntilIdle(harness);
		const capped = harness.readGeometry();
		harness.setGeometry({ maxScrollTop: capped.scrollTop });
		harness.controller.settle();
		advanceUntilIdle(harness);
		expect(harness.controller.getSnapshot()).toMatchObject({
			following: true,
			buttonLabel: null,
		});
	});

	it("moves forward to the unseen end when settlement arrives with a cap", () => {
		const capped = createHarness();
		capped.setReferenceRow({ id: "r1", top: 100 });
		startPinned(capped);
		const before = capped.readGeometry();
		capped.setGeometry({
			edgeBottom: (before.edgeBottom ?? 0) + 1_500,
			maxScrollTop: before.maxScrollTop + 1_500,
		});
		capped.controller.contentChanged();
		advanceUntilIdle(capped);
		const scrollBeforeSettle = capped.readGeometry().scrollTop;
		capped.controller.settle();
		advanceUntilIdle(capped);
		const settled = capped.readGeometry();
		expect(settled.scrollTop).toBeGreaterThan(scrollBeforeSettle);
		expect(settled.scrollTop).toBe(settled.maxScrollTop);
		expect(capped.controller.getSnapshot()).toMatchObject({ following: true, buttonLabel: null });

		const ordinary = createHarness();
		startPinned(ordinary);
		ordinary.controller.settle();
		expect(ordinary.controller.getSnapshot()).toMatchObject({ following: true, buttonLabel: null });
	});

	it("clears a tall-arrival cap when Follow response returns to the edge", () => {
		const harness = createHarness();
		harness.setReferenceRow({ id: "r1", top: 100 });
		startPinned(harness);
		const before = harness.readGeometry();
		harness.setGeometry({
			edgeBottom: (before.edgeBottom ?? 0) + 1_500,
			maxScrollTop: before.maxScrollTop + 1_500,
		});
		harness.controller.contentChanged();
		advanceUntilIdle(harness);
		harness.controller.returnToEdge();
		advanceUntilIdle(harness);
		const geometry = harness.readGeometry();
		expect(geometry.edgeBottom).toBeCloseTo(600, 8);
	});

	it("pins a fast per-frame text stream in a short viewport without a tall-arrival cap", () => {
		const harness = createHarness({ viewportHeight: 300 });
		harness.setReferenceRow({ id: "r1", top: 100 });
		harness.controller.contentChanged();
		harness.setGeometry({ scrollTop: 100, maxScrollTop: 100, edgeBottom: 301 });
		harness.controller.contentChanged();
		harness.advance(TALL_ARRIVAL_SETTLE_MS);
		const startingScrollTop = harness.readGeometry().scrollTop;
		for (let frame = 1; frame <= 60; frame += 1) {
			grow(harness, 20);
			expect(harness.readGeometry().edgeBottom).toBe(300);
			expect(harness.readGeometry().scrollTop).toBe(startingScrollTop + frame * 20);
			harness.advance(16);
		}
	});

	it("pins fast text on a low pin line in a short viewport without a tall-arrival cap", () => {
		const harness = createHarness({ viewportHeight: 300, movement: { trigger: 35 } });
		harness.setReferenceRow({ id: "r1", top: 100 });
		harness.controller.contentChanged();
		harness.setGeometry({ scrollTop: 100, maxScrollTop: 100, edgeBottom: 106 });
		harness.controller.contentChanged();
		harness.advance(TALL_ARRIVAL_SETTLE_MS);
		const startingScrollTop = harness.readGeometry().scrollTop;
		for (let frame = 1; frame <= 60; frame += 1) {
			grow(harness, 14);
			expect(harness.readGeometry().edgeBottom).toBe(105);
			expect(harness.readGeometry().scrollTop).toBe(startingScrollTop + frame * 14);
			harness.advance(16);
		}
	});

	it("caps one jump taller than the viewport on a low pin line", () => {
		const harness = createHarness({ viewportHeight: 300, movement: { trigger: 35 } });
		harness.setReferenceRow({ id: "r1", top: 100 });
		harness.controller.contentChanged();
		harness.setGeometry({ scrollTop: 100, maxScrollTop: 100, edgeBottom: 106 });
		harness.controller.contentChanged();
		harness.advance(TALL_ARRIVAL_SETTLE_MS);
		const before = harness.readGeometry();
		grow(harness, 400);
		expect(harness.readGeometry().scrollTop).toBeLessThan(before.scrollTop + 400);
		expect(harness.readGeometry().edgeBottom).toBeGreaterThan(105);
	});

	it("pins a streaming text response without a tall-arrival cap", () => {
		const harness = createHarness();
		harness.setReferenceRow({ id: "r1", top: 100 });
		startPinned(harness);
		const startingScrollTop = harness.readGeometry().scrollTop;
		for (let delta = 1; delta <= 40; delta += 1) {
			grow(harness, 30);
			expect(harness.readGeometry().edgeBottom).toBe(600);
			expect(harness.readGeometry().scrollTop).toBe(startingScrollTop + delta * 30);
			expect(harness.pendingFrames()).toBe(0);
			harness.advance(50);
		}
	});
});

describe("reading-band on-screen restoration", () => {
	it("grows room only when needed and writes the desired scroll position", () => {
		const harness = createHarness();
		harness.controller.restoreScrollTop(1_100);

		expect(harness.runwayHeights).toEqual([100]);
		expect(harness.writes.at(-1)).toBe(1_100);
		expect(harness.readGeometry()).toMatchObject({ scrollTop: 1_100, maxScrollTop: 1_100 });
	});

	it("never shrinks existing room", () => {
		const harness = createHarness();
		harness.controller.restoreScrollTop(1_100);
		harness.setGeometry({ scrollTop: 700 });
		harness.controller.restoreScrollTop(800);

		expect(harness.runwayHeights).toEqual([100]);
		expect(harness.writes.at(-1)).toBe(800);
		expect(harness.readGeometry()).toMatchObject({ scrollTop: 800, maxScrollTop: 1_100 });
	});

	it("restores within the current range without touching room", () => {
		const harness = createHarness();
		harness.controller.restoreScrollTop(500);

		expect(harness.runwayHeights).toEqual([]);
		expect(harness.writes).toEqual([500]);
		expect(harness.readGeometry().scrollTop).toBe(500);
	});

	it("keeps a reserved position when the content becomes shorter than the viewport", () => {
		const harness = createHarness({ streaming: true });
		harness.setGeometry({ scrollTop: 282, maxScrollTop: 282, edgeBottom: 300 });
		harness.controller.reserveRoom(452);
		harness.setGeometry({ maxScrollTop: 348 });
		harness.controller.reconcileRoom();
		expect(harness.runwayHeights.at(-1)).toBe(386);
		expect(harness.readGeometry().scrollTop).toBe(282);
	});

	it("re-applies the pin after restoring an anchor that Virtuoso compensated", () => {
		const harness = createHarness();
		startPinned(harness);
		const before = harness.readGeometry();
		harness.setGeometry({
			maxScrollTop: before.maxScrollTop + 70,
			scrollTop: before.scrollTop + 70,
		});
		harness.controller.contentChanged();
		const writes = harness.writes.length;
		harness.controller.restoreScrollTop(before.scrollTop);
		expect(harness.writes.slice(writes)).toEqual([before.scrollTop + 70]);
		expect(harness.readGeometry()).toMatchObject({
			scrollTop: before.scrollTop + 70,
			edgeBottom: 600,
		});
	});

	it("restores without pinning once the reader is detached", () => {
		const harness = createHarness();
		startPinned(harness);
		harness.controller.readerLeft();
		const before = harness.readGeometry();
		harness.setGeometry({
			maxScrollTop: before.maxScrollTop + 70,
			scrollTop: before.scrollTop + 70,
		});
		harness.controller.restoreScrollTop(before.scrollTop);
		expect(harness.readGeometry()).toMatchObject({ scrollTop: before.scrollTop, edgeBottom: 670 });
	});

	it("reports its active motion kind and pending native input", () => {
		const harness = createHarness();
		expect(harness.controller.getMotionKind()).toBeNull();
		expect(harness.controller.isNativeInputPending()).toBe(false);

		harness.controller.readerLeft();
		harness.setGeometry({ edgeBottom: 751 });
		harness.controller.returnToEdge();
		expect(harness.controller.getMotionKind()).toBe("follow");
		const resume = harness.controller.interruptForNativeInput();
		expect(harness.controller.getMotionKind()).toBeNull();
		expect(harness.controller.isNativeInputPending()).toBe(true);

		resume();
		expect(harness.controller.getMotionKind()).toBe("follow");
		expect(harness.controller.isNativeInputPending()).toBe(false);
	});
});
