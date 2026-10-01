import { describe, expect, it } from "bun:test";
import {
	createReadingBandController,
	headerHeightScrollTarget,
	type ReadingBandEnvironment,
	type ReadingBandGeometry,
} from "./readingBand";

interface Harness {
	controller: ReturnType<typeof createReadingBandController>;
	anchors: Array<{ index: number; inset: number }>;
	writes: number[];
	runwayHeights: number[];
	setGeometry: (patch: Partial<ReadingBandGeometry>) => void;
	setRowTop: (id: string, top: number | null) => void;
	setReferenceRow: (row: { id: string; top: number } | null) => void;
	readGeometry: () => ReadingBandGeometry;
	setGeometryAvailable: (available: boolean) => void;
	advance: (milliseconds: number) => void;
	pendingFrames: () => number;
	cancelledFrames: () => number;
}

function createHarness({
	streaming = true,
	reducedMotion = false,
	viewportHeight = 600,
	latestEdge = "bottom",
	geometryAvailable = true,
	movement = { settle: 75, trigger: 100 },
}: {
	streaming?: boolean;
	reducedMotion?: boolean;
	viewportHeight?: number;
	latestEdge?: "top" | "bottom";
	geometryAvailable?: boolean;
	movement?: { settle: number; trigger: number };
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
		onStateChange: () => undefined,
	};
	const controller = createReadingBandController(environment, {
		streaming,
		latestEdge,
		movement,
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
	};
}

function advanceUntilIdle(harness: Harness, limit = 300) {
	for (let frame = 0; frame < limit && harness.pendingFrames() > 0; frame += 1) {
		harness.advance(16);
	}
	expect(harness.pendingFrames()).toBe(0);
}

function startConvergedHold(harness: Harness) {
	harness.controller.contentChanged();
	harness.setGeometry({ scrollTop: 100, maxScrollTop: 100, edgeBottom: 601 });
	harness.controller.contentChanged();
	advanceUntilIdle(harness);
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
	it("smoothly follows one large layout expansion to the configured settle line", () => {
		const harness = createHarness();
		harness.setGeometry({ edgeBottom: 900, maxScrollTop: 900 });
		harness.controller.contentChanged();
		advanceUntilIdle(harness);
		expect(harness.writes.at(-1)).toBe(550);
		expect(harness.pendingFrames()).toBe(0);
	});

	it("uses the same destination without animation under reduced motion", () => {
		const harness = createHarness({ reducedMotion: true });
		harness.setGeometry({ edgeBottom: 601 });
		harness.controller.contentChanged();
		expect(harness.writes).toEqual([251]);
		expect(harness.pendingFrames()).toBe(0);
	});

	it("uses the response edge to calculate the settle destination", () => {
		const harness = createHarness({ reducedMotion: true, latestEdge: "top" });
		harness.setGeometry({ edgeBottom: 601 });
		harness.controller.contentChanged();
		expect(harness.writes).toEqual([251]);
	});

	it("re-evaluates immediately when the configured window changes", () => {
		const harness = createHarness({ reducedMotion: true });
		harness.setGeometry({ edgeBottom: 500 });
		harness.controller.contentChanged();
		expect(harness.writes).toEqual([]);
		harness.controller.setMovement({ settle: 60, trigger: 80 });
		expect(harness.writes).toEqual([240]);
	});

	it("re-evaluates the percentage window when the live viewport shrinks", () => {
		const harness = createHarness({ reducedMotion: true });
		harness.setGeometry({ scrollTop: 100, maxScrollTop: 100, edgeBottom: 500 });
		harness.controller.contentChanged();
		expect(harness.writes).toEqual([]);
		harness.setGeometry({ viewportHeight: 400, maxScrollTop: 300 });
		harness.controller.contentChanged();
		expect(harness.runwayHeights).toEqual([]);
		expect(harness.writes).toEqual([300]);
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
	it("cancels an in-flight advance immediately and ignores later content growth", () => {
		const harness = createHarness();
		harness.setGeometry({ edgeBottom: 601 });
		harness.controller.contentChanged();
		harness.advance(100);
		const writesBeforeLeaving = harness.writes.length;
		harness.controller.readerLeft();
		harness.advance(120);
		harness.setGeometry({ edgeBottom: 800 });
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
		following.setGeometry({ edgeBottom: 601 });
		following.controller.contentChanged();
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
			edgeBottom: 601,
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
		expect(harness.writes.at(-1)).toBe(251);
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
		harness.setGeometry({ scrollTop: 100, edgeBottom: 600 });
		harness.controller.contentChanged();
		expect(harness.controller.getSnapshot().following).toBe(false);

		harness.controller.readerReachedEdge();
		expect(harness.controller.getSnapshot().following).toBe(true);

		harness.controller.readerLeft();
		harness.controller.returnToEdge();
		expect(harness.writes.at(-1)).toBe(250);
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

	it("reconstructs an active stream at Settle and leaves a settled mount untouched", () => {
		const active = createHarness({ latestEdge: "top" });
		active.setGeometry({ scrollTop: 200, maxScrollTop: 900, edgeBottom: 600 });
		active.controller.reconstructActiveStream();
		active.controller.reconstructActiveStream();
		expect(active.writes).toEqual([350]);
		expect(active.controller.getSnapshot().runway).toBe(true);

		const settled = createHarness({ streaming: false });
		settled.controller.reconstructActiveStream();
		expect(settled.writes).toEqual([]);
		expect(settled.controller.getSnapshot().runway).toBe(false);
	});

	it("does not mistake a newly started turn for an active-stream remount", () => {
		const harness = createHarness({ streaming: false });
		harness.controller.armImmediateTurn();
		harness.controller.setStreaming(true);
		harness.setGeometry({ scrollTop: 200, maxScrollTop: 900, edgeBottom: 600 });
		harness.controller.reconstructActiveStream();
		expect(harness.writes).toEqual([]);
	});

	it("reconstructs at Settle after message order switches during a stream", () => {
		const harness = createHarness();
		harness.setGeometry({ scrollTop: 200, maxScrollTop: 900, edgeBottom: 600 });
		harness.controller.reconstructActiveStream();
		harness.controller.setLatestEdge("top");
		harness.setGeometry({ scrollTop: 300, maxScrollTop: 900, edgeBottom: 600 });
		harness.controller.reconstructActiveStream();
		expect(harness.writes).toEqual([350, 450]);
	});
});

describe("reading-band derived room", () => {
	it("fills only after Trigger and exponentially converges to Settle without overshoot", () => {
		const harness = createHarness();
		harness.setGeometry({ scrollTop: 100, maxScrollTop: 100, edgeBottom: 600 });
		harness.controller.contentChanged();
		expect(harness.runwayHeights).toEqual([]);
		expect(harness.writes).toEqual([]);

		harness.setGeometry({ edgeBottom: 601 });
		harness.controller.contentChanged();
		expect(harness.runwayHeights).toEqual([151]);
		expect(harness.pendingFrames()).toBe(1);
		harness.advance(16);
		const alpha = 1 - Math.exp(-16 / 90);
		expect(harness.writes[0]).toBeCloseTo(100 + 151 * alpha, 8);
		expect(harness.writes[0]).toBeGreaterThan(100);
		expect(harness.writes[0]).toBeLessThan(251);
		advanceUntilIdle(harness);
		expect(
			harness.writes.every((value, index, values) => index === 0 || value >= values[index - 1]),
		).toBe(true);
		expect(harness.writes.at(-1)).toBe(251);
	});

	it("holds Settle while response growth preserves its derived room", () => {
		const harness = createHarness();
		harness.setGeometry({ scrollTop: 100, maxScrollTop: 100, edgeBottom: 601 });
		harness.controller.contentChanged();
		advanceUntilIdle(harness);
		expect(harness.readGeometry().scrollTop).toBe(251);
		expect(harness.runwayHeights).toEqual([151]);

		harness.setGeometry({ edgeBottom: 490, maxScrollTop: 291 });
		harness.controller.contentChanged();
		expect(harness.runwayHeights).toEqual([151]);
		advanceUntilIdle(harness);
		expect(harness.readGeometry().scrollTop).toBe(291);
		expect(harness.runwayHeights).toEqual([151]);
	});

	it("does not wait for Trigger again while holding", () => {
		const harness = createHarness();
		harness.setGeometry({ scrollTop: 100, maxScrollTop: 100, edgeBottom: 601 });
		harness.controller.contentChanged();
		advanceUntilIdle(harness);
		harness.setGeometry({ edgeBottom: 455, maxScrollTop: 256 });
		harness.controller.contentChanged();
		advanceUntilIdle(harness);
		expect(harness.readGeometry().scrollTop).toBe(256);
		expect(harness.readGeometry().edgeBottom).toBe(450);
		expect(harness.runwayHeights).toEqual([151]);
	});

	it("uses custom Trigger and Settle in either message order under reduced motion", () => {
		for (const latestEdge of ["bottom", "top"] as const) {
			const harness = createHarness({
				latestEdge,
				movement: { settle: 60, trigger: 90 },
				reducedMotion: true,
			});
			harness.setGeometry({ scrollTop: 100, maxScrollTop: 100, edgeBottom: 541 });
			harness.controller.contentChanged();
			expect(harness.runwayHeights).toEqual([181]);
			expect(harness.writes.at(-1)).toBe(281);
		}
	});

	it("gives reduced motion the same final hold geometry immediately", () => {
		const animated = createHarness();
		const reduced = createHarness({ reducedMotion: true });
		for (const harness of [animated, reduced]) {
			harness.setGeometry({ scrollTop: 100, maxScrollTop: 100, edgeBottom: 601 });
			harness.controller.contentChanged();
		}
		expect(reduced.pendingFrames()).toBe(0);
		expect(reduced.readGeometry().scrollTop).toBe(251);
		expect(reduced.readGeometry().maxScrollTop).toBe(251);
		advanceUntilIdle(animated);
		expect(reduced.readGeometry().scrollTop).toBe(animated.readGeometry().scrollTop);
		expect(reduced.readGeometry().maxScrollTop).toBe(animated.readGeometry().maxScrollTop);
		expect(reduced.readGeometry().edgeBottom).toBeCloseTo(
			animated.readGeometry().edgeBottom ?? 0,
			10,
		);
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
		harness.setGeometry({ scrollTop: 100, maxScrollTop: 100, edgeBottom: 601 });
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

		harness.setGeometry({ scrollTop: 150, edgeBottom: 551 });
		harness.controller.reconcileRoom();
		expect(harness.readGeometry().scrollTop).toBe(150);
		expect(harness.runwayHeights.at(-1)).toBe(50);
		expect(harness.writes).toEqual(writes);
		harness.setGeometry({ maxScrollTop: 170, edgeBottom: 571 });
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
		harness.setGeometry({ scrollTop: 100, maxScrollTop: 100, edgeBottom: 601 });
		harness.controller.contentChanged();
		harness.controller.readerLeft();
		harness.setGeometry({ scrollTop: 150, edgeBottom: 551 });
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

	it("reconciles hold room on a content notification while the follow glide is moving", () => {
		const harness = createHarness();
		harness.setGeometry({ scrollTop: 100, maxScrollTop: 100, edgeBottom: 601 });
		harness.controller.contentChanged();
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
		harness.setGeometry({ edgeBottom: 601 });
		harness.controller.contentChanged();
		expect(harness.readGeometry().scrollTop).toBe(251);
	});

	it("Follow response derives room and holds Settle through later growth", () => {
		const harness = createHarness();
		harness.controller.readerLeft();
		harness.setGeometry({ scrollTop: 100, maxScrollTop: 100, edgeBottom: 601 });
		harness.controller.returnToEdge();
		expect(harness.runwayHeights).toEqual([151]);
		advanceUntilIdle(harness);
		expect(harness.readGeometry().scrollTop).toBe(251);
		harness.setGeometry({ edgeBottom: 470, maxScrollTop: 271 });
		harness.controller.contentChanged();
		advanceUntilIdle(harness);
		expect(harness.readGeometry().scrollTop).toBe(271);
		expect(harness.readGeometry().edgeBottom).toBe(450);
		expect(harness.runwayHeights).toEqual([151]);
	});

	it("clamps a reduced-motion hold after its same-frame room write", () => {
		const harness = createHarness({ reducedMotion: true });
		harness.setGeometry({ scrollTop: 100, maxScrollTop: 100, edgeBottom: 601 });
		harness.controller.contentChanged();
		expect(harness.runwayHeights).toEqual([151]);
		expect(harness.writes).toEqual([251]);
		expect(harness.readGeometry().maxScrollTop).toBe(251);
	});

	it("does not reschedule a converged hold or recurse through contentChanged", () => {
		const harness = createHarness();
		harness.setGeometry({ scrollTop: 100, maxScrollTop: 100, edgeBottom: 601 });
		harness.controller.contentChanged();
		advanceUntilIdle(harness);
		const writes = [...harness.writes];
		harness.controller.contentChanged();
		expect(harness.pendingFrames()).toBe(0);
		expect(harness.writes).toEqual(writes);
	});

	it("pending native input blocks automatic following until it resolves", () => {
		const harness = createHarness();
		harness.setGeometry({ scrollTop: 100, maxScrollTop: 100, edgeBottom: 601 });
		harness.controller.contentChanged();
		advanceUntilIdle(harness);
		const resume = harness.controller.interruptForNativeInput("pending");
		const writes = [...harness.writes];
		harness.setGeometry({ edgeBottom: 490, maxScrollTop: 291 });
		harness.controller.contentChanged();
		expect(harness.pendingFrames()).toBe(0);
		expect(harness.writes).toEqual(writes);

		resume();
		advanceUntilIdle(harness);
		expect(harness.writes.at(-1)).toBe(291);
	});

	it("reader takeover releases pending native input so a later edge return follows", () => {
		const harness = createHarness();
		harness.setGeometry({ scrollTop: 100, maxScrollTop: 100, edgeBottom: 601 });
		harness.controller.contentChanged();
		advanceUntilIdle(harness);
		harness.controller.interruptForNativeInput("pending");
		harness.controller.readerLeft();
		harness.controller.readerReachedEdge();
		harness.setGeometry({ edgeBottom: 560, maxScrollTop: 311 });
		harness.controller.contentChanged();
		advanceUntilIdle(harness);
		expect(harness.controller.getSnapshot().following).toBe(true);
		expect(harness.writes.at(-1)).toBe(361);
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
		startConvergedHold(harness);
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
		expect(resumedGeometry.edgeBottom).toBeCloseTo(450, 8);

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
		startConvergedHold(harness);
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
		expect(harness.readGeometry().edgeBottom).toBeCloseTo(450, 8);
	});

	it("caps one tall arrival while holding so its start lands at the turn inset", () => {
		const harness = createHarness();
		harness.setReferenceRow({ id: "r1", top: 100 });
		startConvergedHold(harness);
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
		startConvergedHold(harness);
		const before = harness.readGeometry();
		const previousEdgeDoc = before.scrollTop + (before.edgeBottom ?? 0);
		for (let chunk = 1; chunk <= 4; chunk += 1) {
			const current = harness.readGeometry();
			harness.setGeometry({
				edgeBottom: (current.edgeBottom ?? 0) + 350,
				maxScrollTop: current.maxScrollTop + 350,
			});
			harness.controller.contentChanged();
		}
		advanceUntilIdle(harness);
		expect(harness.readGeometry().scrollTop).toBeLessThanOrEqual(previousEdgeDoc - 60 + 1);
	});

	it("rebases the follow cap across width reflow before measuring the next growth", () => {
		const harness = createHarness();
		harness.setReferenceRow({ id: "r1", top: 100 });
		startConvergedHold(harness);
		const before = harness.readGeometry();
		harness.controller.rebaseFollowCap();
		harness.setGeometry({
			edgeBottom: (before.edgeBottom ?? 0) + 1_500,
			maxScrollTop: before.maxScrollTop + 1_500,
		});
		harness.controller.contentChanged();
		advanceUntilIdle(harness);
		const expectedSettle =
			before.scrollTop + (before.edgeBottom ?? 0) + 1_500 - before.viewportHeight * 0.75;
		expect(harness.readGeometry().scrollTop).toBeCloseTo(expectedSettle, 8);
	});

	it("keeps an existing cap after rebasing before small growth", () => {
		const harness = createHarness();
		harness.setReferenceRow({ id: "r1", top: 100 });
		startConvergedHold(harness);
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
		const settle = after.scrollTop + (after.edgeBottom ?? 0) - after.viewportHeight * 0.75;
		expect(after.scrollTop).toBeCloseTo(capped.scrollTop, 8);
		expect(after.scrollTop).toBeLessThan(settle);
	});

	it("does not cap an edge shift caused by content above the reference row", () => {
		const harness = createHarness();
		harness.setReferenceRow({ id: "r1", top: 100 });
		startConvergedHold(harness);
		const before = harness.readGeometry();
		const previousEdgeDoc = before.scrollTop + (before.edgeBottom ?? 0);
		const expectedSettle = previousEdgeDoc + 600 - before.viewportHeight * 0.75;
		harness.setGeometry({
			scrollTop: before.scrollTop + 600,
			maxScrollTop: before.maxScrollTop + 600,
		});
		harness.setReferenceRow({ id: "r1", top: 700 });
		harness.controller.contentChanged();
		advanceUntilIdle(harness);
		expect(harness.readGeometry().scrollTop).toBeCloseTo(expectedSettle, 8);
		harness.controller.settle();
		advanceUntilIdle(harness);
		expect(harness.controller.getSnapshot().following).toBe(true);
	});

	it("moves an active cap with its reference content", () => {
		const harness = createHarness();
		harness.setReferenceRow({ id: "r1", top: 100 });
		startConvergedHold(harness);
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
		startConvergedHold(harness);
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
		startConvergedHold(harness);
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
		startConvergedHold(harness);
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
		const settle = capped.scrollTop + (capped.edgeBottom ?? 0) - capped.viewportHeight * 0.75;
		harness.setRowTop("r1", null);
		harness.setReferenceRow(null);
		expect(() => harness.controller.contentChanged()).not.toThrow();
		advanceUntilIdle(harness);
		expect(harness.readGeometry().scrollTop).toBeCloseTo(settle, 8);
	});

	it("does not cap newest-first growth, where latest rows are prepended", () => {
		const harness = createHarness({ latestEdge: "top" });
		harness.setReferenceRow({ id: "r1", top: 100 });
		startConvergedHold(harness);
		const before = harness.readGeometry();
		harness.setGeometry({
			edgeBottom: (before.edgeBottom ?? 0) + 1_500,
			maxScrollTop: before.maxScrollTop + 1_500,
		});
		harness.controller.contentChanged();
		advanceUntilIdle(harness);
		const after = harness.readGeometry();
		expect((after.edgeBottom ?? 0) / after.viewportHeight).toBeCloseTo(0.75, 2);
		harness.controller.settle();
		expect(harness.controller.getSnapshot().following).toBe(true);
	});

	it("releases a tall-arrival cap by twice each growth until Settle resumes", () => {
		const harness = createHarness();
		harness.setReferenceRow({ id: "r1", top: 100 });
		startConvergedHold(harness);
		const before = harness.readGeometry();
		const oldEdgeDoc = before.scrollTop + (before.edgeBottom ?? 0);
		harness.setGeometry({
			edgeBottom: (before.edgeBottom ?? 0) + 1_500,
			maxScrollTop: before.maxScrollTop + 1_500,
		});
		harness.controller.contentChanged();
		advanceUntilIdle(harness);

		let expectedDestination = oldEdgeDoc - 60;
		let previousDestination = expectedDestination;
		for (let update = 0; update < 12; update += 1) {
			const current = harness.readGeometry();
			harness.setGeometry({
				edgeBottom: (current.edgeBottom ?? 0) + 100,
				maxScrollTop: current.maxScrollTop + 100,
			});
			const expectedSettle = current.scrollTop + (current.edgeBottom ?? 0) + 100 - 450;
			expectedDestination = Math.min(expectedSettle, expectedDestination + 200);
			harness.controller.contentChanged();
			advanceUntilIdle(harness);
			expect(harness.readGeometry().scrollTop).toBeCloseTo(expectedDestination, 8);
			expect(expectedDestination).toBeGreaterThanOrEqual(previousDestination);
			expect(expectedDestination).toBeLessThanOrEqual(expectedSettle);
			previousDestination = expectedDestination;
		}

		const current = harness.readGeometry();
		harness.setGeometry({
			edgeBottom: (current.edgeBottom ?? 0) + 100,
			maxScrollTop: current.maxScrollTop + 100,
		});
		const nextSettle = current.scrollTop + (current.edgeBottom ?? 0) + 100 - 450;
		harness.controller.contentChanged();
		advanceUntilIdle(harness);
		expect(harness.readGeometry().scrollTop).toBe(nextSettle);
		expect(nextSettle).toBeGreaterThan(previousDestination);
	});

	it("does not push an active cap for a second tall arrival", () => {
		const harness = createHarness();
		harness.setReferenceRow({ id: "r1", top: 100 });
		startConvergedHold(harness);
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

	it("caps the first glide when a tall arrival crosses Trigger from the fill phase", () => {
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
		startConvergedHold(harness);
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
		startConvergedHold(capped);
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
		startConvergedHold(ordinary);
		ordinary.controller.settle();
		expect(ordinary.controller.getSnapshot()).toMatchObject({ following: true, buttonLabel: null });
	});

	it("clears a tall-arrival cap when Follow response returns to the edge", () => {
		const harness = createHarness();
		harness.setReferenceRow({ id: "r1", top: 100 });
		startConvergedHold(harness);
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
		expect(geometry.edgeBottom).toBeCloseTo(450, 8);
	});

	it("does not cap gradual response growth", () => {
		const harness = createHarness();
		harness.setReferenceRow({ id: "r1", top: 100 });
		startConvergedHold(harness);
		for (let update = 0; update < 40; update += 1) {
			const current = harness.readGeometry();
			harness.setGeometry({
				edgeBottom: (current.edgeBottom ?? 0) + 30,
				maxScrollTop: current.maxScrollTop + 30,
			});
			harness.controller.contentChanged();
			advanceUntilIdle(harness);
			const geometry = harness.readGeometry();
			expect(geometry.edgeBottom).toBeCloseTo(450, 8);
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

	it("reports its active motion kind and pending native input", () => {
		const harness = createHarness();
		expect(harness.controller.getMotionKind()).toBeNull();
		expect(harness.controller.isNativeInputPending()).toBe(false);

		harness.setGeometry({ edgeBottom: 601 });
		harness.controller.contentChanged();
		expect(harness.controller.getMotionKind()).toBe("follow");
		const resume = harness.controller.interruptForNativeInput();
		expect(harness.controller.getMotionKind()).toBeNull();
		expect(harness.controller.isNativeInputPending()).toBe(true);

		resume();
		expect(harness.controller.getMotionKind()).toBe("follow");
		expect(harness.controller.isNativeInputPending()).toBe(false);
	});
});
