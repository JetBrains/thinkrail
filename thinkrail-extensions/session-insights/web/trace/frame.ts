import type { TraceEvent } from "@thinkrail/pi-session-insights/core";
import { isFailure, type SeriesKey, seriesOf, type TraceModel } from "./model";
import type { TimeScale, View } from "./scale";

export const ROW_HEIGHT = 24;
/** Narrower spans than this draw as a 1px tick; group rows merge their children per pixel. */
const MIN_BAR_PX = 1;

export type BarShape =
	/** A call with a duration. */
	| "span"
	/** A moment: a prompt, a marker, a call without a duration. */
	| "point"
	/** A call that never got a result. */
	| "missing"
	/** The extent of a turn or a subagent run. */
	| "extent";

export interface Bar {
	row: number;
	event: number;
	x0: number;
	x1: number;
	shape: BarShape;
	series: SeriesKey | null;
	error: boolean;
	/** The span's timing is approximated from timestamps, not pi's `durationMs`. */
	approximate: boolean;
	label: string;
}

/** A merged pixel run of a collapsed row's descendants: one colour per pixel, failures winning. */
export interface Tick {
	row: number;
	x: number;
	width: number;
	series: SeriesKey;
	error: boolean;
}

export interface Frame {
	firstRow: number;
	bars: Bar[];
	ticks: Tick[];
}

export interface FrameInput {
	model: TraceModel;
	rows: readonly number[];
	open: (index: number) => boolean;
	scale: TimeScale;
	view: View;
	width: number;
	scrollTop: number;
	height: number;
}

function xOf(scale: TimeScale, view: View, width: number, time: number): number {
	return ((scale.toUnit(time) - view.u0) / (view.u1 - view.u0)) * width;
}

function barLabel(event: TraceEvent): string {
	switch (event.kind) {
		case "tool":
			return event.head ?? event.tool;
		case "llm":
			return event.model?.split("/").pop() ?? "";
		case "subagent":
			return event.role ?? "";
		default:
			return "";
	}
}

function shapeOf(event: TraceEvent): BarShape {
	if (event.kind === "turn" || event.kind === "subagent") return "extent";
	if (event.kind === "tool" && event.missing) return "missing";
	if (event.kind === "mark" || event.t1 <= event.t0) return "point";
	return "span";
}

export interface PixelSpan {
	x0: number;
	x1: number;
	series: SeriesKey;
	error: boolean;
}

/**
 * Level of detail for dense rows: spans are rasterized to whole pixels inside `0..width`, a failing
 * span wins its pixels, and equal neighbours merge into one run.
 */
export function mergePixels(spans: readonly PixelSpan[], width: number): Omit<Tick, "row">[] {
	const columns = Math.max(0, Math.ceil(width));
	if (columns === 0) return [];
	const series: (SeriesKey | null)[] = new Array(columns).fill(null);
	const errors = new Uint8Array(columns);
	for (const span of spans) {
		if (span.x1 < 0 || span.x0 > width) continue;
		const from = Math.min(columns - 1, Math.max(0, Math.floor(span.x0)));
		const to = Math.min(columns, Math.max(from + MIN_BAR_PX, Math.ceil(span.x1)));
		for (let x = from; x < to; x++) {
			if (errors[x]) continue;
			series[x] = span.series;
			if (span.error) errors[x] = 1;
		}
	}
	const out: Omit<Tick, "row">[] = [];
	for (let x = 0; x < columns; x++) {
		const key = series[x];
		if (!key) continue;
		const error = errors[x] === 1;
		const last = out[out.length - 1];
		if (last && last.x + last.width === x && last.series === key && last.error === error)
			last.width += 1;
		else out.push({ x, width: 1, series: key, error });
	}
	return out;
}

/** The bars and merged ticks of the rows inside the viewport; nothing outside it is computed. */
export function layoutFrame(input: FrameInput): Frame {
	const { model, rows, scale, view, width } = input;
	const firstRow = Math.max(0, Math.floor(input.scrollTop / ROW_HEIGHT));
	const lastRow = Math.min(
		rows.length,
		Math.ceil((input.scrollTop + input.height) / ROW_HEIGHT) + 1,
	);
	const bars: Bar[] = [];
	const ticks: Tick[] = [];
	for (let row = firstRow; row < lastRow; row++) {
		const index = rows[row];
		const event = index === undefined ? undefined : model.at(index);
		if (index === undefined || !event) continue;
		const x0 = xOf(scale, view, width, event.t0);
		const x1 = Math.max(x0, xOf(scale, view, width, event.t1));
		bars.push({
			row,
			event: index,
			x0,
			x1,
			shape: shapeOf(event),
			series: seriesOf(event),
			error: event.error === true,
			approximate: event.timing === "approximated",
			label: barLabel(event),
		});
		if (event.kind !== "turn" || input.open(index)) continue;
		const spans: PixelSpan[] = [];
		const end = model.end[index] ?? index + 1;
		for (let child = index + 1; child < end; child++) {
			const descendant = model.at(child);
			if (!descendant || (descendant.kind !== "tool" && descendant.kind !== "llm")) continue;
			const series = seriesOf(descendant);
			if (!series) continue;
			const failed = isFailure(descendant);
			const from = failed && descendant.kind === "llm" ? descendant.t1 : descendant.t0;
			spans.push({
				x0: xOf(scale, view, width, from),
				x1: xOf(scale, view, width, descendant.t1),
				series,
				error: failed,
			});
		}
		for (const tick of mergePixels(spans, width)) ticks.push({ ...tick, row });
	}
	return { firstRow, bars, ticks };
}

export interface Hit {
	row: number;
	event: number;
	onBar: boolean;
}

/** The row under a point, and whether the point is on its bar (with a few pixels of slack). */
export function hitTest(
	frame: Frame,
	scrollTop: number,
	x: number,
	y: number,
	slack = 4,
): Hit | null {
	const row = Math.floor((y + scrollTop) / ROW_HEIGHT);
	const bar = frame.bars.find((candidate) => candidate.row === row);
	if (!bar) return null;
	const right = bar.shape === "span" || bar.shape === "extent" ? bar.x1 : bar.x0;
	return { row, event: bar.event, onBar: x >= bar.x0 - slack && x <= right + slack };
}
