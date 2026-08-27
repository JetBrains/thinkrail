import { describe, expect, it } from "bun:test";
import {
	createReadingBandController,
	type ReadingBandEnvironment,
	type ReadingBandGeometry,
} from "./readingBand";

interface Harness {
	controller: ReturnType<typeof createReadingBandController>;
	anchors: Array<{ index: number; inset: number }>;
	writes: number[];
	runwayHeights: number[];
	setGeometry: (patch: Partial<ReadingBandGeometry>) => void;
	advance: (milliseconds: number) => void;
	pendingFrames: () => number;
	cancelledFrames: () => number;
}

function createHarness({
	streaming = true,
	reducedMotion = false,
	viewportHeight = 600,
}: {
	streaming?: boolean;
	reducedMotion?: boolean;
	viewportHeight?: number;
} = {}): Harness {
	let geometry: ReadingBandGeometry = {
		viewportHeight,
		scrollTop: 100,
		maxScrollTop: 1_000,
		edgeBottom: viewportHeight * 0.5,
	};
	let now = 0;
	let frameId = 0;
	let cancelled = 0;
	const frames = new Map<number, (time: number) => void>();
	const anchors: Array<{ index: number; inset: number }> = [];
	const writes: number[] = [];
	const runwayHeights: number[] = [];

	const environment: ReadingBandEnvironment = {
		readGeometry: () => geometry,
		writeScrollTop: (top) => {
			writes.push(top);
			const delta = top - geometry.scrollTop;
			geometry = { ...geometry, scrollTop: top, edgeBottom: geometry.edgeBottom - delta };
		},
		writeRunwayHeight: (height) => runwayHeights.push(height),
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
	const controller = createReadingBandController(environment, { streaming });

	return {
		controller,
		anchors,
		writes,
		runwayHeights,
		setGeometry: (patch) => {
			geometry = { ...geometry, ...patch };
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
	it("holds inside the runway, then advances the 82% edge to 58% in one move", () => {
		const harness = createHarness();
		harness.setGeometry({ edgeBottom: 492 });
		harness.controller.contentChanged();
		expect(harness.writes).toEqual([]);

		harness.setGeometry({ edgeBottom: 500 });
		harness.controller.contentChanged();
		expect(harness.pendingFrames()).toBe(1);
		expect(harness.controller.getSnapshot().moving).toBe(true);

		harness.controller.contentChanged();
		expect(harness.pendingFrames()).toBe(1);

		harness.advance(219);
		expect(harness.writes.at(-1)).toBeLessThan(252);
		expect(harness.controller.getSnapshot().moving).toBe(true);

		harness.advance(1);
		expect(harness.writes.at(-1)).toBe(252);
		expect(harness.controller.getSnapshot().moving).toBe(false);
	});

	it("consumes a 60% runway down to the 42% reading-band floor without re-inflating", () => {
		const harness = createHarness({ streaming: false });
		harness.setGeometry({ edgeBottom: 300 });
		harness.controller.armImmediateTurn();
		harness.controller.userTurnArrived(2, "immediate");
		expect(harness.runwayHeights).toEqual([612]);

		harness.controller.setStreaming(true);
		harness.controller.readerLeft();
		harness.setGeometry({ edgeBottom: 400 });
		harness.controller.contentChanged();
		expect(harness.runwayHeights.at(-1)).toBe(512);

		harness.setGeometry({ edgeBottom: 900 });
		harness.controller.contentChanged();
		expect(harness.runwayHeights.at(-1)).toBe(252);

		harness.setGeometry({ edgeBottom: 500 });
		harness.controller.contentChanged();
		expect(harness.runwayHeights.at(-1)).toBe(252);
	});

	it("recalibrates retained runway when the transcript viewport resizes", () => {
		const harness = createHarness({ streaming: false });
		harness.setGeometry({ edgeBottom: 300 });
		harness.controller.armImmediateTurn();
		harness.controller.userTurnArrived(2, "immediate");
		harness.controller.setStreaming(false);

		harness.setGeometry({ viewportHeight: 800 });
		harness.controller.contentChanged();
		expect(harness.runwayHeights.at(-1)).toBe(816);

		harness.setGeometry({ viewportHeight: 400 });
		harness.controller.contentChanged();
		expect(harness.runwayHeights.at(-1)).toBe(408);
	});

	it("turns one large layout expansion into one advance to the settle line", () => {
		const harness = createHarness();
		harness.setGeometry({ edgeBottom: 900, maxScrollTop: 900 });
		harness.controller.contentChanged();
		harness.advance(220);
		expect(harness.writes).toEqual([652]);
		expect(harness.pendingFrames()).toBe(0);
	});

	it("uses the same sparse destination without animation under reduced motion", () => {
		const harness = createHarness({ reducedMotion: true });
		harness.setGeometry({ edgeBottom: 500 });
		harness.controller.contentChanged();
		expect(harness.writes).toEqual([252]);
		expect(harness.pendingFrames()).toBe(0);
		expect(harness.controller.getSnapshot().moving).toBe(false);
	});
});

describe("reading-band reader intent", () => {
	it("cancels an in-flight advance immediately and ignores later content growth", () => {
		const harness = createHarness();
		harness.setGeometry({ edgeBottom: 500 });
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
			runway: true,
			buttonLabel: "Follow response",
		});
	});

	it("does not re-arm from geometry alone, but manual return and the button do", () => {
		const harness = createHarness();
		harness.controller.readerLeft();
		harness.setGeometry({ scrollTop: 1_000, edgeBottom: 348 });
		harness.controller.contentChanged();
		expect(harness.controller.getSnapshot().following).toBe(false);

		harness.controller.readerReachedEdge();
		expect(harness.controller.getSnapshot().following).toBe(true);

		harness.controller.readerLeft();
		harness.setGeometry({ scrollTop: 300, maxScrollTop: 900 });
		harness.controller.returnToEdge();
		expect(harness.writes.at(-1)).toBe(900);
		expect(harness.controller.getSnapshot().following).toBe(true);
	});

	it("settles without catch-up or runway collapse and changes the detached action to Latest", () => {
		const harness = createHarness();
		harness.setGeometry({ edgeBottom: 500 });
		harness.controller.contentChanged();
		harness.controller.setStreaming(false);
		harness.advance(220);
		harness.controller.readerLeft();

		expect(harness.writes).toEqual([]);
		expect(harness.controller.getSnapshot()).toEqual({
			following: false,
			moving: false,
			runway: true,
			buttonLabel: "Latest",
		});
	});

	it("reconstructs an active remount at the band edge but leaves a settled mount untouched", () => {
		const active = createHarness();
		active.setGeometry({ scrollTop: 200, maxScrollTop: 900 });
		active.controller.reconstructActiveStream();
		active.controller.reconstructActiveStream();
		expect(active.runwayHeights).toEqual([252]);
		expect(active.writes).toEqual([900]);
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
		harness.setGeometry({ scrollTop: 200, maxScrollTop: 900 });
		harness.controller.reconstructActiveStream();
		expect(harness.writes).toEqual([]);
	});
});
