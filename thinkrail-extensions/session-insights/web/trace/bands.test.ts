import { describe, expect, test } from "bun:test";
import type { SkillActivation } from "@thinkrail/pi-session-insights/core";
import { clipSpan, drawSkillRow, hatch, type Visible } from "./bands";
import { PALETTE, recordingContext, type StrokedLine } from "./canvas.test";
import { T0 } from "./events.test";
import { clampView, TimeScale, type View } from "./scale";

const HOUR = 3_600_000;
const HATCH_PX = 5;
/** The trace header's canvas, and the timeline's plot past its 112 px gutter. */
const VIEWPORTS: readonly Visible[] = [
	{ left: 0, right: 1000 },
	{ left: 112, right: 1112 },
];

function skill(t: number, scopeEnd: number): SkillActivation {
	return {
		name: "shipping-a-pr",
		t,
		eventId: "t1",
		via: "read",
		workflow: false,
		scopeEnd,
		scopeBy: "turnEnd",
	};
}

function xOf(scale: TimeScale, view: View, visible: Visible) {
	return (t: number) =>
		visible.left +
		((scale.toUnit(t) - view.u0) / (view.u1 - view.u0)) * (visible.right - visible.left);
}

/** The hatch loop before review of #1417: every line of the whole span, off-screen ones included. */
function walkedHatch(x0: number, width: number, height: number): number[] {
	const out: number[] = [];
	for (let x = x0 - height; x < x0 + width; x += HATCH_PX) out.push(x);
	return out;
}

/** Whether a hatch line starting at `x` shows inside its band's clip and the viewport. */
function shows(x: number, height: number, band: [number, number], visible: Visible): boolean {
	const from = Math.max(band[0], visible.left);
	const to = Math.min(band[1], visible.right);
	return from <= to && x + height >= from && x <= to;
}

function hatchLines(x0: number, width: number, height: number, visible: Visible): StrokedLine[] {
	const { context, record } = recordingContext();
	hatch(context, x0, 0, width, height, "#000", visible);
	return record.lines;
}

describe("skill hatching", () => {
	test("an eight-hour scope at the minimum zoom hatches the viewport, not the span", () => {
		const scale = new TimeScale(T0, T0 + 8 * HOUR, [], null);
		const view = clampView(scale, { u0: 4 * HOUR, u1: 4 * HOUR + 1 });
		expect(view.u1 - view.u0).toBe(200);
		for (const visible of VIEWPORTS) {
			const width = visible.right - visible.left;
			const row = () => {
				const { context, record } = recordingContext();
				drawSkillRow(
					context,
					[skill(T0, T0 + 8 * HOUR)],
					xOf(scale, view, visible),
					0,
					20,
					visible,
					PALETTE,
					0,
				);
				return record;
			};
			const record = row();
			expect(record.lineTos).toBeGreaterThan(width / HATCH_PX);
			expect(record.lineTos).toBeLessThanOrEqual(width / HATCH_PX + 20);
			let elapsed = Number.POSITIVE_INFINITY;
			for (let run = 0; run < 3; run += 1) {
				const started = performance.now();
				row();
				elapsed = Math.min(elapsed, performance.now() - started);
			}
			expect(elapsed).toBeLessThan(process.env.SESSION_INSIGHTS_PERF === "1" ? 2 : 20);
		}
	});

	test("draws the lines in view exactly as the whole-span loop did, in its clip", () => {
		const scale = new TimeScale(T0, T0 + 20_000, [], null);
		const scope = skill(T0 + 5_000, T0 + 15_000);
		const views: View[] = [
			{ u0: 4_950, u1: 5_150 },
			{ u0: 9_000, u1: 9_200 },
			{ u0: 14_900, u1: 15_100 },
			{ u0: 0, u1: 20_000 },
			{ u0: 2_000, u1: 12_000 },
		];
		const height = 12;
		for (const visible of VIEWPORTS)
			for (const view of views) {
				const at = xOf(scale, view, visible);
				const x0 = at(scope.t);
				const width = at(scope.scopeEnd) - x0;
				const band: [number, number] = [x0, x0 + width];
				const lines = hatchLines(x0, width, height, visible);
				const drawn = lines.map((line) => line.x0).filter((x) => shows(x, height, band, visible));
				const walked = walkedHatch(x0, width, height).filter((x) =>
					shows(x, height, band, visible),
				);
				expect(drawn.length).toBe(walked.length);
				for (const [index, x] of drawn.entries())
					expect(x).toBeCloseTo(walked[index] ?? Number.NaN, 6);
				for (const line of lines) {
					expect(line.x1 - line.x0).toBe(height);
					expect([line.y0, line.y1]).toEqual([height, 0]);
				}
				const { context, record } = recordingContext();
				hatch(context, x0, 0, width, height, "#000", visible);
				const [clip] = record.clips;
				const shown = (from: number, to: number) => [
					Math.max(from, visible.left),
					Math.min(to, visible.right),
				];
				expect(shown(clip?.x ?? 0, (clip?.x ?? 0) + (clip?.width ?? 0))).toEqual(
					shown(x0, x0 + width),
				);
			}
	});

	test("keeps its phase on the band while the view pans", () => {
		const scale = new TimeScale(T0, T0 + HOUR, [], null);
		const scope = skill(T0, T0 + HOUR);
		const height = 12;
		for (const visible of VIEWPORTS)
			for (let pan = 0; pan < 40; pan += 1) {
				const u0 = HOUR / 2 + pan * 37;
				const at = xOf(scale, { u0, u1: u0 + 200 }, visible);
				const x0 = at(scope.t);
				const lines = hatchLines(x0, at(scope.scopeEnd) - x0, height, visible);
				expect(lines.length).toBeGreaterThan(0);
				for (const line of lines) {
					const periods = (line.x0 - (x0 - height)) / HATCH_PX;
					expect(Math.abs(periods - Math.round(periods))).toBeLessThan(1e-6);
				}
			}
	});
});

describe("clipSpan", () => {
	const visible = { left: 100, right: 300 };

	test("leaves a span in view alone and drops one out of view", () => {
		expect(clipSpan(120, 280, visible, 4)).toEqual({ x0: 120, x1: 280 });
		expect(clipSpan(-500, 90, visible, 4)).toBeNull();
		expect(clipSpan(310, 900, visible, 4)).toBeNull();
	});

	test("cuts each end a whole number of periods from itself, just past the viewport", () => {
		const cut = clipSpan(-1e9 + 0.25, 1e9 + 0.5, visible, 7, 3);
		if (!cut) throw new Error("the span covers the viewport");
		const from = (cut.x0 - (-1e9 + 0.25)) / 7;
		const to = (1e9 + 0.5 - cut.x1) / 7;
		expect(Math.abs(from - Math.round(from))).toBeLessThan(1e-6);
		expect(Math.abs(to - Math.round(to))).toBeLessThan(1e-6);
		expect(cut.x0).toBeLessThanOrEqual(visible.left - 3);
		expect(cut.x0).toBeGreaterThan(visible.left - 3 - 7);
		expect(cut.x1).toBeGreaterThanOrEqual(visible.right + 3);
		expect(cut.x1).toBeLessThan(visible.right + 3 + 7);
	});
});
