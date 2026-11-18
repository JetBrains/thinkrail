import type { TraceGap } from "@thinkrail/pi-session-insights/core";

/** Idle stretches longer than this are drawn compressed, as a labelled break. */
export const COMPRESS_GAPS_OVER_MS = 2 * 60_000;
/** Zoom per wheel delta pixel, for every canvas on this axis. */
export const WHEEL_ZOOM = 0.0018;
const GAP_SHARE = 0.03;
const GAP_MIN_MS = 5_000;
const GAP_MAX_MS = 120_000;
const MIN_VIEW_MS = 200;
const TICK_STEPS_MS = [
	100, 250, 500, 1_000, 2_000, 5_000, 10_000, 15_000, 30_000, 60_000, 120_000, 300_000, 600_000,
	900_000, 1_800_000, 3_600_000, 7_200_000, 10_800_000, 21_600_000, 43_200_000, 86_400_000,
];
const MIN_TICK_PX = 84;

/** A compressed gap on the axis: real time `t0..t1` drawn over axis units `u0..u1`. */
export interface AxisBreak extends TraceGap {
	u0: number;
	u1: number;
}

/** Real time ↔ axis units; views, zoom, ticks and the brush work on any of them. */
export interface AxisScale {
	readonly breaks: readonly AxisBreak[];
	readonly min: number;
	readonly max: number;
	toUnit(time: number): number;
	toTime(unit: number): number;
}

function piecewise(from: Float64Array, to: Float64Array, value: number): number {
	const last = from.length - 1;
	const first = from[0] ?? 0;
	const final = from[last] ?? 0;
	if (value <= first) return (to[0] ?? 0) - (first - value);
	if (value >= final) return (to[last] ?? 0) + (value - final);
	let lo = 0;
	let hi = last;
	while (hi - lo > 1) {
		const mid = (lo + hi) >> 1;
		if ((from[mid] ?? 0) <= value) lo = mid;
		else hi = mid;
	}
	const fromLo = from[lo] ?? 0;
	const toLo = to[lo] ?? 0;
	const span = (from[hi] ?? 0) - fromLo;
	if (span <= 0) return toLo;
	return toLo + ((value - fromLo) * ((to[hi] ?? 0) - toLo)) / span;
}

/**
 * Real time ↔ axis units, piecewise linear: identity inside activity, each compressed gap squeezed to
 * a fixed width (a few percent of the active span, clamped).
 */
export class TimeScale implements AxisScale {
	readonly breaks: readonly AxisBreak[];
	private readonly times: Float64Array;
	private readonly units: Float64Array;

	/** `breakWidth` overrides the width (in axis units) each compressed gap is drawn at. */
	constructor(
		start: number,
		end: number,
		gaps: readonly TraceGap[],
		compressOverMs: number | null,
		breakWidth?: number,
	) {
		const times = [start];
		const units = [0];
		const breaks: AxisBreak[] = [];
		const compressed =
			compressOverMs === null ? [] : gaps.filter((gap) => gap.t1 - gap.t0 > compressOverMs);
		const idle = compressed.reduce((sum, gap) => sum + (gap.t1 - gap.t0), 0);
		const width =
			breakWidth ?? Math.min(GAP_MAX_MS, Math.max(GAP_MIN_MS, (end - start - idle) * GAP_SHARE));
		let lastT = start;
		let lastU = 0;
		const push = (time: number, unit: number) => {
			times.push(time);
			units.push(unit);
			lastT = time;
			lastU = unit;
		};
		for (const gap of compressed) {
			const from = Math.max(gap.t0, lastT);
			if (gap.t1 <= from) continue;
			const u0 = lastU + (from - lastT);
			if (from > lastT) push(from, u0);
			push(gap.t1, u0 + width);
			breaks.push({ ...gap, t0: from, u0, u1: u0 + width });
		}
		if (end > lastT) push(end, lastU + (end - lastT));
		if (times.length === 1) push(start + 1, 1);
		this.times = Float64Array.from(times);
		this.units = Float64Array.from(units);
		this.breaks = breaks;
	}

	get min(): number {
		return this.units[0] ?? 0;
	}

	get max(): number {
		return this.units.at(-1) ?? 0;
	}

	toUnit(time: number): number {
		return piecewise(this.times, this.units, time);
	}

	toTime(unit: number): number {
		return piecewise(this.units, this.times, unit);
	}
}

/** Axis units per step on a step axis, so a view's minimum span is a fraction of a step. */
export const STEP_UNITS = 1000;

/**
 * The "by step" axis: every model call starts one step further, whatever the time between calls; time
 * inside a step is linear. Ticks count steps (`stepTicks`).
 */
export class StepScale implements AxisScale {
	readonly breaks: readonly AxisBreak[] = [];
	private readonly times: Float64Array;
	private readonly units: Float64Array;

	constructor(stepStarts: readonly number[], start: number, end: number) {
		const times: number[] = [start];
		const units: number[] = [0];
		for (const at of [...stepStarts].sort((a, b) => a - b)) {
			if (at <= (times.at(-1) ?? start)) continue;
			times.push(at);
			units.push((units.at(-1) ?? 0) + STEP_UNITS);
		}
		if (end > (times.at(-1) ?? start)) {
			times.push(end);
			units.push((units.at(-1) ?? 0) + STEP_UNITS);
		}
		if (times.length === 1) {
			times.push(start + 1);
			units.push(STEP_UNITS);
		}
		this.times = Float64Array.from(times);
		this.units = Float64Array.from(units);
	}

	get min(): number {
		return 0;
	}

	get max(): number {
		return this.units.at(-1) ?? 0;
	}

	toUnit(time: number): number {
		const last = this.times.length - 1;
		const clamped = Math.min(this.times[last] ?? time, Math.max(this.times[0] ?? time, time));
		return piecewise(this.times, this.units, clamped);
	}

	toTime(unit: number): number {
		const clamped = Math.min(this.max, Math.max(0, unit));
		return piecewise(this.units, this.times, clamped);
	}
}

export interface StepTick {
	x: number;
	step: number;
}

/** Round step numbers (1-based) in view, at least `MIN_TICK_PX` apart. */
export function stepTicks(view: View, width: number): StepTick[] {
	const span = view.u1 - view.u0;
	if (!(span > 0) || width <= 0) return [];
	const steps = span / STEP_UNITS;
	const raw = (steps * MIN_TICK_PX) / width;
	const magnitude = 10 ** Math.floor(Math.log10(Math.max(raw, 1)));
	const every =
		[1, 2, 5, 10].map((factor) => factor * magnitude).find((step) => step >= raw) ?? 10 * magnitude;
	const out: StepTick[] = [];
	for (
		let step = Math.max(0, Math.ceil(view.u0 / STEP_UNITS / every) * every);
		step * STEP_UNITS <= view.u1;
		step += every
	)
		out.push({ x: ((step * STEP_UNITS - view.u0) / span) * width, step: step + 1 });
	return out;
}

/** The visible window in axis units. */
export interface View {
	u0: number;
	u1: number;
}

export function fitView(scale: AxisScale): View {
	const pad = (scale.max - scale.min) * 0.01 || 1;
	return { u0: scale.min - pad, u1: scale.max + pad };
}

export function clampView(scale: AxisScale, view: View): View {
	const full = (scale.max - scale.min) * 1.04 || 1;
	let span = view.u1 - view.u0;
	if (!(span > 0) || span >= full) return fitView(scale);
	let u0 = view.u0;
	if (span < MIN_VIEW_MS) {
		const middle = (view.u0 + view.u1) / 2;
		span = MIN_VIEW_MS;
		u0 = middle - span / 2;
	}
	const lo = scale.min - full * 0.02;
	const hi = scale.max + full * 0.02;
	u0 = Math.min(Math.max(u0, lo), hi - span);
	return { u0, u1: u0 + span };
}

export function zoomView(scale: AxisScale, view: View, atUnit: number, factor: number): View {
	return clampView(scale, {
		u0: atUnit - (atUnit - view.u0) * factor,
		u1: atUnit + (view.u1 - atUnit) * factor,
	});
}

export function panView(scale: AxisScale, view: View, units: number): View {
	return clampView(scale, { u0: view.u0 + units, u1: view.u1 + units });
}

/** A view showing `t0..t1` with `pad` of its span on either side. */
export function viewAround(scale: AxisScale, t0: number, t1: number, pad = 0.3): View {
	let u0 = scale.toUnit(t0);
	let u1 = scale.toUnit(Math.max(t0, t1));
	if (u1 - u0 < MIN_VIEW_MS * 5) {
		const middle = (u0 + u1) / 2;
		u0 = middle - MIN_VIEW_MS * 15;
		u1 = middle + MIN_VIEW_MS * 15;
	}
	const margin = (u1 - u0) * pad;
	return clampView(scale, { u0: u0 - margin, u1: u1 + margin });
}

/** Pans, never zooms, so `t` is inside the view. */
export function viewContaining(scale: AxisScale, view: View, t: number): View {
	const unit = scale.toUnit(t);
	if (unit >= view.u0 && unit <= view.u1) return view;
	const span = view.u1 - view.u0;
	return clampView(scale, { u0: unit - span * 0.3, u1: unit - span * 0.3 + span });
}

export interface Tick {
	x: number;
	time: number;
	/** The step is a day or longer, or the tick starts a new day. */
	day: boolean;
	seconds: boolean;
}

/**
 * Ticks at a round step, only inside activity segments (never inside a compressed break). Each segment
 * starts at its first round step, so a compressed gap costs nothing however long it is.
 */
export function ticks(scale: AxisScale, view: View, width: number, offsetMs: number): Tick[] {
	const span = view.u1 - view.u0;
	if (!(span > 0) || width <= 0) return [];
	const pxPerMs = width / span;
	const step = TICK_STEPS_MS.find((candidate) => candidate * pxPerMs >= MIN_TICK_PX) ?? 86_400_000;
	const out: Tick[] = [];
	const t1 = scale.toTime(view.u1);
	let from = scale.toTime(view.u0);
	let lastX = Number.NEGATIVE_INFINITY;
	let lastDay: number | null = null;
	const segment = (to: number) => {
		for (let t = Math.ceil((from - offsetMs) / step) * step + offsetMs; t <= to; t += step) {
			const x = ((scale.toUnit(t) - view.u0) / span) * width;
			if (x - lastX < MIN_TICK_PX * 0.7) continue;
			const day = Math.floor((t - offsetMs) / 86_400_000);
			out.push({ x, time: t, day: step >= 86_400_000 || day !== lastDay, seconds: step < 60_000 });
			lastX = x;
			lastDay = day;
		}
	};
	for (const gap of scale.breaks) {
		if (gap.t1 <= from) continue;
		if (gap.t0 >= t1) break;
		segment(gap.t0);
		from = gap.t1;
	}
	segment(t1);
	return out;
}

/**
 * `ticks` remembering its last answer, for an engine whose hover redraws the axis: a redraw that moved
 * neither the scale, the view, the width nor the offset gets the same ticks back.
 */
export function tickMemo(): typeof ticks {
	let last: { key: readonly unknown[]; out: Tick[] } | null = null;
	return (scale, view, width, offsetMs) => {
		const key = [scale, view.u0, view.u1, width, offsetMs];
		if (last?.key.every((value, at) => value === key[at])) return last.out;
		const out = ticks(scale, view, width, offsetMs);
		last = { key, out };
		return out;
	};
}

export type BrushGrip =
	| { kind: "start" | "end" }
	| { kind: "move"; x0: number; view: View }
	| { kind: "new"; x0: number; moved: boolean };

const BRUSH_HANDLE_PX = 6;
const BRUSH_DRAG_PX = 4;

/** Overview x (over the whole axis, `0..width`) ↔ axis units. */
export function overviewUnit(scale: AxisScale, width: number, x: number): number {
	return scale.min + (x / Math.max(1, width)) * (scale.max - scale.min);
}

export function overviewX(scale: AxisScale, width: number, unit: number): number {
	return ((unit - scale.min) / (scale.max - scale.min || 1)) * width;
}

/** What a press at `x` on the overview grabs: an edge of the brush, the brush, or a new range. */
export function brushGrip(scale: AxisScale, view: View, width: number, x: number): BrushGrip {
	const start = overviewX(scale, width, view.u0);
	const end = overviewX(scale, width, view.u1);
	if (Math.abs(x - start) < BRUSH_HANDLE_PX) return { kind: "start" };
	if (Math.abs(x - end) < BRUSH_HANDLE_PX) return { kind: "end" };
	if (x > start && x < end) return { kind: "move", x0: x, view };
	return { kind: "new", x0: x, moved: false };
}

/** The view after dragging `grip` to `x`; `null` while a new range is still under the drag threshold. */
export function brushDrag(
	scale: AxisScale,
	view: View,
	width: number,
	grip: BrushGrip,
	x: number,
): View | null {
	const unit = overviewUnit(scale, width, x);
	switch (grip.kind) {
		case "start":
			return clampView(scale, { u0: Math.min(unit, view.u1 - 1), u1: view.u1 });
		case "end":
			return clampView(scale, { u0: view.u0, u1: Math.max(unit, view.u0 + 1) });
		case "move":
			return panView(scale, grip.view, unit - overviewUnit(scale, width, grip.x0));
		case "new": {
			if (Math.abs(x - grip.x0) > BRUSH_DRAG_PX) grip.moved = true;
			if (!grip.moved) return null;
			const anchor = overviewUnit(scale, width, grip.x0);
			return clampView(scale, { u0: Math.min(anchor, unit), u1: Math.max(anchor, unit) });
		}
	}
}

/** A click (no drag) on the overview recentres the view there, keeping its span; other grips change nothing. */
export function brushClick(
	scale: AxisScale,
	view: View,
	width: number,
	grip: BrushGrip,
): View | null {
	if (grip.kind !== "new" || grip.moved) return null;
	const unit = overviewUnit(scale, width, grip.x0);
	const span = view.u1 - view.u0;
	return clampView(scale, { u0: unit - span / 2, u1: unit + span / 2 });
}
