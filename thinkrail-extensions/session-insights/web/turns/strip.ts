import type { TraceGap } from "@thinkrail/pi-session-insights/core";
import { mergePixels, type PixelSpan } from "../trace/frame";
import { FAMILY_SERIES, isFailure, LLM_SERIES, type TraceModel } from "../trace/model";
import type { Palette } from "../trace/palette";
import { type AxisScale, COMPRESS_GAPS_OVER_MS, TimeScale } from "../trace/scale";

/** A turn's own axis: its span with the idle stretches inside it compressed like the trace's. */
export function turnScale(t0: number, t1: number, gaps: readonly TraceGap[]): TimeScale {
	const inside = gaps.flatMap((gap) =>
		gap.t1 > t0 && gap.t0 < t1
			? [{ ...gap, t0: Math.max(t0, gap.t0), t1: Math.min(t1, gap.t1) }]
			: [],
	);
	return new TimeScale(t0, Math.max(t1, t0 + 1), inside, COMPRESS_GAPS_OVER_MS);
}

function xOf(scale: AxisScale, width: number, time: number): number {
	return ((scale.toUnit(time) - scale.min) / (scale.max - scale.min || 1)) * width;
}

/**
 * The activity strip of the events `from..to` on `scale`: tool calls by family on top, waits for the
 * user behind them, model calls as a thin line below, failures in the error colour, breaks as rules.
 */
export function drawActivity(
	context: CanvasRenderingContext2D,
	width: number,
	height: number,
	model: TraceModel,
	range: { from: number; to: number },
	scale: AxisScale,
	palette: Palette,
): void {
	context.clearRect(0, 0, width, height);
	context.fillStyle = palette.grid;
	context.globalAlpha = 0.5;
	context.fillRect(0, 0, width, height);
	context.globalAlpha = 1;
	const tools: PixelSpan[] = [];
	const calls: PixelSpan[] = [];
	for (let at = range.from; at < range.to; at++) {
		const event = model.at(at);
		if (!event) continue;
		const x0 = xOf(scale, width, event.t0);
		const x1 = Math.max(x0 + 1, xOf(scale, width, event.t1));
		if (event.kind === "tool" && event.family === "ask") {
			context.fillStyle = palette.series.primary;
			context.globalAlpha = 0.3;
			context.fillRect(x0, 0, x1 - x0, height);
			context.globalAlpha = 1;
		}
		if (event.kind === "tool")
			tools.push({ x0, x1, series: FAMILY_SERIES[event.family], error: isFailure(event) });
		else if (event.kind === "llm")
			calls.push({ x0, x1, series: LLM_SERIES, error: isFailure(event) });
	}
	for (const run of mergePixels(tools, width)) {
		context.fillStyle = run.error ? palette.error : palette.series[run.series];
		context.fillRect(run.x, 1, run.width, height - 5);
	}
	for (const run of mergePixels(calls, width)) {
		context.fillStyle = run.error ? palette.error : palette.series[run.series];
		context.fillRect(run.x, height - 3, run.width, 3);
	}
	context.fillStyle = palette.subtle;
	for (const gap of scale.breaks) {
		const x = Math.round(
			xOf(scale, width, gap.t0) + (xOf(scale, width, gap.t1) - xOf(scale, width, gap.t0)) / 2,
		);
		context.fillRect(x, 0, 1, height);
	}
}

/** A step's place inside its turn: a bar over the step's span on the turn's axis. */
export function drawPlace(
	context: CanvasRenderingContext2D,
	width: number,
	height: number,
	scale: AxisScale,
	span: { t0: number; t1: number; error: boolean },
	palette: Palette,
): void {
	context.clearRect(0, 0, width, height);
	context.fillStyle = palette.grid;
	context.fillRect(0, height / 2 - 0.5, width, 1);
	const x0 = xOf(scale, width, span.t0);
	const x1 = Math.max(x0 + 2, xOf(scale, width, span.t1));
	context.fillStyle = span.error ? palette.error : palette.series[LLM_SERIES];
	context.fillRect(x0, 2, x1 - x0, height - 4);
}
