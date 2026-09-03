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
	let runwayHeight = 0;

	const environment: ReadingBandEnvironment = {
		readGeometry: () => (hasGeometry ? geometry : null),
		readScrollBounds: () => geometry,
		readViewportHeight: () => geometry.viewportHeight,
		writeScrollTop: (top) => {
			const bounded = Math.min(geometry.maxScrollTop, Math.max(0, top));
			writes.push(bounded);
			const delta = bounded - geometry.scrollTop;
			geometry = {
				...geometry,
				scrollTop: bounded,
				edgeBottom: geometry.edgeBottom === null ? null : geometry.edgeBottom - delta,
				...(geometry.runwayBottom === undefined
					? {}
					: {
							runwayBottom: geometry.runwayBottom === null ? null : geometry.runwayBottom - delta,
						}),
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
				...(geometry.runwayBottom === undefined
					? {}
					: {
							runwayBottom: geometry.runwayBottom === null ? null : geometry.runwayBottom - delta,
						}),
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
	it("turns one large layout expansion into one advance to the configured settle line", () => {
		const harness = createHarness();
		harness.setGeometry({ edgeBottom: 900, maxScrollTop: 900 });
		harness.controller.contentChanged();
		harness.advance(220);
		expect(harness.writes).toEqual([550]);
		expect(harness.pendingFrames()).toBe(0);
	});

	it("uses the same destination without animation under reduced motion", () => {
		const harness = createHarness({ reducedMotion: true });
		harness.setGeometry({ edgeBottom: 601 });
		harness.controller.contentChanged();
		expect(harness.writes).toEqual([251]);
		expect(harness.pendingFrames()).toBe(0);
	});

	it("measures movement from the response edge instead of the stable runway marker", () => {
		const harness = createHarness({ reducedMotion: true, latestEdge: "top" });
		harness.setGeometry({ edgeBottom: 601, runwayBottom: 300 });
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
		expect(harness.writes).toEqual([0]);
	});

	it("keeps a settled Latest return pinned through delayed measurement", () => {
		const harness = createHarness({ streaming: false });
		harness.controller.readerLeft();
		harness.setGeometry({ scrollTop: 300, maxScrollTop: 900 });
		harness.controller.returnToEdge();
		expect(harness.writes).toEqual([900]);
		for (let frame = 0; frame < 10; frame += 1) harness.advance(16);
		harness.setGeometry({ maxScrollTop: 1_400 });
		harness.advance(16);
		expect(harness.writes.at(-1)).toBe(1_400);
		for (let frame = 0; frame < 19; frame += 1) harness.advance(16);
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
	it("waits for the 100% trigger, adds only missing room, and moves to 75%", () => {
		const harness = createHarness();
		harness.setGeometry({
			scrollTop: 100,
			maxScrollTop: 100,
			edgeBottom: 600,
			runwayBottom: 600,
		});
		harness.controller.contentChanged();
		expect(harness.runwayHeights).toEqual([]);

		harness.setGeometry({ edgeBottom: 601, runwayBottom: 601 });
		harness.controller.contentChanged();
		expect(harness.runwayHeights).toEqual([151]);
		harness.advance(220);
		expect(harness.writes.at(-1)).toBe(251);
	});

	it("uses custom trigger and settle values in both message orders", () => {
		for (const latestEdge of ["bottom", "top"] as const) {
			const harness = createHarness({
				latestEdge,
				movement: { settle: 60, trigger: 90 },
				reducedMotion: true,
			});
			harness.setGeometry({
				scrollTop: 100,
				maxScrollTop: 100,
				edgeBottom: 541,
				runwayBottom: 541,
			});
			harness.controller.contentChanged();
			expect(harness.runwayHeights).toEqual([181]);
			expect(harness.writes.at(-1)).toBe(281);
		}
	});

	it("consumes derived room one-for-one as the response grows", () => {
		const harness = createHarness({ reducedMotion: true });
		harness.setGeometry({
			scrollTop: 100,
			maxScrollTop: 100,
			edgeBottom: 601,
			runwayBottom: 601,
		});
		harness.controller.contentChanged();
		expect(harness.runwayHeights).toEqual([151]);

		harness.setGeometry({ edgeBottom: 550, runwayBottom: 550, maxScrollTop: 351 });
		harness.controller.contentChanged();
		expect(harness.runwayHeights.at(-1)).toBe(51);
	});

	it("starts consuming when a virtualized stable marker appears", () => {
		const harness = createHarness({ reducedMotion: true, latestEdge: "top" });
		harness.setGeometry({
			scrollTop: 100,
			maxScrollTop: 100,
			edgeBottom: 601,
			runwayBottom: null,
		});
		harness.controller.contentChanged();
		expect(harness.runwayHeights).toEqual([151]);

		harness.setGeometry({ edgeBottom: 450, runwayBottom: 450 });
		harness.controller.contentChanged();
		harness.setGeometry({ edgeBottom: 550, runwayBottom: 550, maxScrollTop: 351 });
		harness.controller.contentChanged();
		expect(harness.runwayHeights.at(-1)).toBe(51);
	});

	it("consumes cumulative newest-first growth from the stable trailing marker", () => {
		const harness = createHarness({ reducedMotion: true, latestEdge: "top" });
		harness.setGeometry({
			scrollTop: 100,
			maxScrollTop: 100,
			edgeBottom: 601,
			runwayBottom: 500,
		});
		harness.controller.contentChanged();
		expect(harness.runwayHeights).toEqual([151]);

		harness.setGeometry({ edgeBottom: 400, runwayBottom: 449, maxScrollTop: 351 });
		harness.controller.contentChanged();
		expect(harness.runwayHeights.at(-1)).toBe(51);
	});

	it("smoothly removes remaining room when the agent settles", () => {
		const harness = createHarness();
		harness.setGeometry({
			scrollTop: 100,
			maxScrollTop: 100,
			edgeBottom: 601,
			runwayBottom: 601,
		});
		harness.controller.contentChanged();
		harness.advance(220);
		harness.controller.setStreaming(false);
		expect(harness.controller.getSnapshot().runway).toBe(true);
		harness.advance(220);
		expect(harness.runwayHeights.at(-1)).toBe(0);
		expect(harness.controller.getSnapshot().runway).toBe(false);
	});

	it("reader takeover removes room, detaches, and ignores later growth", () => {
		const harness = createHarness({ reducedMotion: true });
		harness.setGeometry({
			scrollTop: 100,
			maxScrollTop: 100,
			edgeBottom: 601,
			runwayBottom: 601,
		});
		harness.controller.contentChanged();
		harness.controller.readerLeft();
		expect(harness.runwayHeights.at(-1)).toBe(0);
		expect(harness.controller.getSnapshot()).toMatchObject({
			following: false,
			runway: false,
			buttonLabel: "Follow response",
		});
		const writes = harness.writes.length;
		harness.setGeometry({ edgeBottom: 900, runwayBottom: 900 });
		harness.controller.contentChanged();
		expect(harness.writes).toHaveLength(writes);
	});

	it("Follow response returns the active edge to Settle and rearms the window", () => {
		const harness = createHarness({ reducedMotion: true });
		harness.controller.readerLeft();
		harness.setGeometry({
			scrollTop: 100,
			maxScrollTop: 100,
			edgeBottom: 600,
			runwayBottom: 600,
		});
		harness.controller.returnToEdge();
		expect(harness.runwayHeights.at(-1)).toBe(150);
		expect(harness.writes.at(-1)).toBe(250);
		expect(harness.controller.getSnapshot()).toMatchObject({
			following: true,
			runway: true,
			buttonLabel: null,
		});
	});

	it("an attention reveal removes room and suppresses it for the rest of that flow", () => {
		const harness = createHarness({ reducedMotion: true });
		harness.setGeometry({
			scrollTop: 100,
			maxScrollTop: 100,
			edgeBottom: 601,
			runwayBottom: 601,
		});
		harness.controller.contentChanged();
		harness.controller.releaseRunway(false);
		expect(harness.runwayHeights.at(-1)).toBe(0);
		harness.setGeometry({ edgeBottom: 601, runwayBottom: 601 });
		harness.controller.contentChanged();
		expect(harness.runwayHeights.at(-1)).toBe(0);
		expect(harness.controller.getSnapshot().runway).toBe(false);
	});
});
