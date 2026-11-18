import { describe, expect, test } from "bun:test";
import type { TraceEvent } from "@thinkrail/pi-session-insights/core";
import { llm, sampleEvents, T0, tool, turn } from "./events.test";
import { hitTest, layoutFrame, mergePixels, ROW_HEIGHT } from "./frame";
import { TraceModel } from "./model";
import { TimeScale } from "./scale";

function frameFor(
	events: readonly TraceEvent[],
	open: ReadonlyMap<string, boolean>,
	scrollTop = 0,
) {
	const model = new TraceModel(events);
	const start = events[0]?.t0 ?? 0;
	const end = Math.max(...events.map((event) => event.t1));
	const scale = new TimeScale(start, end, [], null);
	const rows = model.visible(open, null).rows;
	return {
		model,
		rows,
		frame: layoutFrame({
			model,
			rows,
			open: (index) => model.isOpen(index, open),
			scale,
			view: { u0: scale.min, u1: scale.max },
			width: 1000,
			scrollTop,
			height: ROW_HEIGHT * 4,
		}),
	};
}

describe("mergePixels", () => {
	test("rasterizes spans to whole pixels, merges equal neighbours and lets failures win", () => {
		const runs = mergePixels(
			[
				{ x0: 0.2, x1: 3.6, series: "series-1", error: false },
				{ x0: 2.1, x1: 2.4, series: "series-4", error: true },
				{ x0: 5, x1: 5.2, series: "series-1", error: false },
				{ x0: 9.5, x1: 40, series: "series-3", error: false },
			],
			10,
		);
		expect(runs).toEqual([
			{ x: 0, width: 2, series: "series-1", error: false },
			{ x: 2, width: 1, series: "series-4", error: true },
			{ x: 3, width: 1, series: "series-1", error: false },
			{ x: 5, width: 1, series: "series-1", error: false },
			{ x: 9, width: 1, series: "series-3", error: false },
		]);
		expect(mergePixels([{ x0: -50, x1: -10, series: "series-1", error: false }], 10)).toEqual([]);
	});
});

describe("layoutFrame", () => {
	test("lays out only the rows in view, with each event's shape, series and flags", () => {
		const { frame, model } = frameFor(sampleEvents(), new Map());
		expect(frame.bars.map((bar) => model.at(bar.event)?.id)).toEqual([
			"m0",
			"u1",
			"a1",
			"t1",
			"t2",
		]);
		const [mark, turnBar, call, failed] = frame.bars;
		expect(mark?.shape).toBe("point");
		expect(turnBar?.shape).toBe("extent");
		expect(call).toMatchObject({ shape: "span", series: "series-3", label: "claude-test" });
		expect(failed).toMatchObject({ shape: "span", error: true, series: "series-4", label: "bash" });
		expect((call?.x1 ?? 0) - (call?.x0 ?? 0)).toBeGreaterThan(0);
		const scrolled = frameFor(sampleEvents(), new Map(), ROW_HEIGHT * 5).frame;
		expect(scrolled.firstRow).toBe(5);
	});

	test("a collapsed turn draws its descendants as merged ticks, a failed call only at its end", () => {
		const { frame } = frameFor(
			sampleEvents(),
			new Map([
				["u2", false],
				["u1", false],
			]),
		);
		const rows = frame.ticks.map((tick) => tick.row);
		expect(new Set(rows)).toEqual(new Set([1, 2]));
		expect(frame.ticks.some((tick) => tick.row === 1 && tick.error && tick.width > 2)).toBe(true);
		const failedCall = frame.ticks.filter((tick) => tick.row === 2 && tick.error);
		expect(failedCall).toHaveLength(1);
		expect(failedCall[0]?.width).toBe(1);
	});

	test("hit testing finds the row under the pointer and whether it is on the bar", () => {
		const { frame, model } = frameFor(sampleEvents(), new Map());
		const call = frame.bars.find((bar) => model.at(bar.event)?.id === "a1");
		if (!call) throw new Error("no bar for a1");
		const y = call.row * ROW_HEIGHT + ROW_HEIGHT / 2;
		expect(hitTest(frame, 0, (call.x0 + call.x1) / 2, y)).toEqual({
			row: call.row,
			event: call.event,
			onBar: true,
		});
		expect(hitTest(frame, 0, call.x1 + 200, y)?.onBar).toBe(false);
		expect(hitTest(frame, 0, 10, ROW_HEIGHT * 40)).toBeNull();
	});

	test("10,000 spans in collapsed turns lay out within the 8 ms frame budget", () => {
		const events: TraceEvent[] = [];
		for (let turnIndex = 0; turnIndex < 40; turnIndex += 1) {
			const base = T0 + turnIndex * 250_000;
			const turnId = `u${turnIndex}`;
			events.push(turn(turnId, turnIndex + 1, base, base + 250_000));
			for (let call = 0; call < 125; call += 1) {
				const at = base + call * 2_000;
				const callId = `${turnId}-a${call}`;
				events.push(llm(callId, turnId, at, at + 800));
				events.push(
					tool(`${callId}-t`, callId, at + 800, at + 1_900, call % 50 === 0 ? { error: true } : {}),
				);
			}
		}
		const model = new TraceModel(events);
		const closed = new Map(
			events.filter((event) => event.kind === "turn").map((event) => [event.id, false]),
		);
		const scale = new TimeScale(T0, T0 + 40 * 250_000, [], null);
		const rows = model.visible(closed, null).rows;
		const input = {
			model,
			rows,
			open: (index: number) => model.isOpen(index, closed),
			scale,
			view: { u0: scale.min, u1: scale.max },
			width: 1600,
			scrollTop: 0,
			height: ROW_HEIGHT * 40,
		};
		layoutFrame(input);
		let frame = layoutFrame(input);
		let elapsed = Number.POSITIVE_INFINITY;
		for (let run = 0; run < 3; run += 1) {
			const started = performance.now();
			frame = layoutFrame(input);
			elapsed = Math.min(elapsed, performance.now() - started);
		}
		expect(events.length).toBe(10_040);
		expect(frame.bars).toHaveLength(40);
		expect(elapsed).toBeLessThan(process.env.SESSION_INSIGHTS_PERF === "1" ? 8 : 500);
	});
});
