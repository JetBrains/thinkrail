import type { ContextCall, SessionContext } from "@thinkrail/pi-session-insights/core";
import type { Palette } from "../trace/palette";
import { CACHE_RAMP, CATEGORIES, CATEGORY_SERIES } from "./look";

/** Layout of the composition chart, CSS pixels. */
export const GUTTER = 52;
export const RIGHT = 12;
export const TOP = 22;
export const BARS = 220;
const GAP = 6;
const MISS_ROW = 10;
const CACHE_ROW = 16;
const AXIS = 18;
export const CHART_HEIGHT = TOP + BARS + GAP + MISS_ROW + CACHE_ROW + AXIS;
export const OVERVIEW_HEIGHT = 28;
/** Below this many pixels per call, each pixel column draws its largest call (failures never hide). */
const LOD_PX = 1.5;
const MIN_SPAN = 6;

/** The window of calls shown, in call positions (−0.5 … n − 0.5 is everything). */
export interface ChartView {
	v0: number;
	v1: number;
}

export function fullView(count: number): ChartView {
	return { v0: -0.5, v1: Math.max(0.5, count - 0.5) };
}

export function clampView(view: ChartView, count: number): ChartView {
	const full = fullView(count);
	let span = view.v1 - view.v0;
	if (span >= full.v1 - full.v0) return full;
	let { v0, v1 } = view;
	if (span < MIN_SPAN) {
		const middle = (v0 + v1) / 2;
		v0 = middle - MIN_SPAN / 2;
		v1 = middle + MIN_SPAN / 2;
		span = MIN_SPAN;
	}
	if (v0 < full.v0) {
		v0 = full.v0;
		v1 = v0 + span;
	}
	if (v1 > full.v1) {
		v1 = full.v1;
		v0 = v1 - span;
	}
	return { v0, v1 };
}

export function zoomAt(view: ChartView, count: number, at: number, factor: number): ChartView {
	return clampView({ v0: at - (at - view.v0) / factor, v1: at + (view.v1 - at) / factor }, count);
}

export function panBy(view: ChartView, count: number, calls: number): ChartView {
	return clampView({ v0: view.v0 + calls, v1: view.v1 + calls }, count);
}

/** The window keeps `index` in view, centring it when it was outside. */
export function viewShowing(view: ChartView, count: number, index: number): ChartView {
	if (index >= view.v0 + 0.5 && index <= view.v1 - 0.5) return view;
	const span = view.v1 - view.v0;
	return clampView({ v0: index - span / 2, v1: index + span / 2 }, count);
}

export function plotWidth(width: number): number {
	return Math.max(1, width - GUTTER - RIGHT);
}

export function xOf(view: ChartView, width: number, position: number): number {
	return GUTTER + ((position - view.v0) / (view.v1 - view.v0)) * plotWidth(width);
}

export function positionAt(view: ChartView, width: number, x: number): number {
	return view.v0 + ((x - GUTTER) / plotWidth(width)) * (view.v1 - view.v0);
}

/** The call under `x`: the nearest one, or the pixel column's largest when calls are thinner than a pixel. */
export function callAt(
	view: ChartView,
	width: number,
	x: number,
	calls: readonly ContextCall[],
): number | null {
	if (x < GUTTER || calls.length === 0) return null;
	const perCall = plotWidth(width) / (view.v1 - view.v0);
	if (perCall >= LOD_PX)
		return Math.max(0, Math.min(calls.length - 1, Math.round(positionAt(view, width, x))));
	const from = Math.max(0, Math.floor(positionAt(view, width, Math.floor(x))));
	const to = Math.min(calls.length - 1, Math.ceil(positionAt(view, width, Math.floor(x) + 1)));
	let best = from;
	for (let at = from; at <= to; at++)
		if ((calls[at]?.total ?? 0) > (calls[best]?.total ?? 0)) best = at;
	return best;
}

export function yMax(context: SessionContext): number {
	const peak = context.peak.value ?? 0;
	const limit = Math.max(0, ...context.limits.map((item) => item.value));
	return Math.max(1, Math.max(peak, limit > 0 && limit < peak * 3 ? limit : 0) * 1.06);
}

function yOf(value: number, max: number): number {
	return TOP + BARS - (value / max) * (BARS - 4);
}

export function sizeCanvas(
	canvas: HTMLCanvasElement,
	width: number,
	height: number,
): CanvasRenderingContext2D | null {
	const ratio = window.devicePixelRatio || 1;
	const w = Math.max(1, Math.round(width * ratio));
	const h = Math.max(1, Math.round(height * ratio));
	if (canvas.width !== w) canvas.width = w;
	if (canvas.height !== h) canvas.height = h;
	const context = canvas.getContext("2d");
	context?.setTransform(ratio, 0, 0, ratio, 0, 0);
	return context;
}

export interface ChartText {
	font: string;
	tokens: (value: number) => string;
	call: (n: number) => string;
	cacheRow: string;
	missRow: string;
	tooltip: (call: ContextCall) => string[];
	/** Names the context windows too large for the scale. */
	offScale: (windows: readonly number[]) => string;
}

interface Drawn {
	call: ContextCall;
	x: number;
	w: number;
}

function visible(calls: readonly ContextCall[], view: ChartView, width: number): Drawn[] {
	const from = Math.max(0, Math.floor(view.v0));
	const to = Math.min(calls.length - 1, Math.ceil(view.v1));
	const perCall = plotWidth(width) / (view.v1 - view.v0);
	const out: Drawn[] = [];
	if (perCall >= LOD_PX) {
		const w = Math.max(1, perCall - (perCall > 4 ? 1 : 0));
		for (let at = from; at <= to; at++) {
			const call = calls[at];
			if (call) out.push({ call, x: xOf(view, width, at) - w / 2, w });
		}
		return out;
	}
	let column: number | null = null;
	let best: ContextCall | null = null;
	let missed = false;
	const flush = () => {
		if (best && column !== null)
			out.push({
				call: missed && !best.miss ? { ...best, miss: { causes: [] } } : best,
				x: column,
				w: 1,
			});
	};
	for (let at = from; at <= to; at++) {
		const call = calls[at];
		if (!call) continue;
		const x = Math.floor(xOf(view, width, at));
		if (x !== column) {
			flush();
			column = x;
			best = call;
			missed = call.miss !== undefined;
		} else {
			if (best && call.total > best.total) best = call;
			missed ||= call.miss !== undefined;
		}
	}
	flush();
	return out;
}

/**
 * The composition chart: stacked category bars per call (prompt order, bottom up), the cache-read line,
 * each model's context window as a dashed line, compaction and model-switch rules, the miss row, the
 * cache strip (read / written / uncached shares) and the call axis; then the hover outline and tooltip.
 */
export function drawChart(
	context: CanvasRenderingContext2D,
	width: number,
	data: SessionContext,
	view: ChartView,
	palette: Palette,
	text: ChartText,
	state: { selected: number | null; hover: { index: number; x: number; y: number } | null },
): void {
	const { calls } = data;
	const max = yMax(data);
	const right = width - RIGHT;
	context.clearRect(0, 0, width, CHART_HEIGHT);
	context.font = text.font;
	context.textBaseline = "middle";
	const step = niceStep(max, 4);
	for (let value = 0; value <= max; value += step) {
		const y = Math.round(yOf(value, max)) + 0.5;
		context.strokeStyle = palette.grid;
		context.setLineDash(value === 0 ? [] : [2, 3]);
		context.beginPath();
		context.moveTo(GUTTER, y);
		context.lineTo(right, y);
		context.stroke();
		context.setLineDash([]);
		context.fillStyle = palette.subtle;
		context.fillText(text.tokens(value), 6, y);
	}
	const missY = TOP + BARS + GAP;
	const cacheY = missY + MISS_ROW;
	context.fillStyle = palette.subtle;
	context.fillText(text.missRow, 6, missY + MISS_ROW / 2);
	context.fillText(text.cacheRow, 6, cacheY + CACHE_ROW / 2);

	context.save();
	context.beginPath();
	context.rect(GUTTER, 0, right - GUTTER, CHART_HEIGHT);
	context.clip();
	const drawn = visible(calls, view, width);
	const readLine: [number, number, number][] = [];
	for (const { call, x, w } of drawn) {
		let acc = 0;
		CATEGORIES.forEach((category, at) => {
			const value = call.parts[at] ?? 0;
			if (value <= 0) return;
			const y0 = yOf(acc, max);
			const y1 = yOf(acc + value, max);
			context.fillStyle = palette.series[CATEGORY_SERIES[category]];
			context.fillRect(x, y1, w, Math.max(0.5, y0 - y1));
			acc += value;
		});
		if (acc < call.total) {
			const y0 = yOf(acc, max);
			const y1 = yOf(call.total, max);
			context.fillStyle = palette.subtle;
			context.fillRect(x, y1, w, Math.max(0.5, y0 - y1));
		}
		const whole = call.total || 1;
		let y = cacheY;
		for (const [value, color] of [
			[call.cacheRead, palette.ramp[CACHE_RAMP.read]],
			[call.cacheWrite, palette.ramp[CACHE_RAMP.write]],
			[call.input, palette.ramp[CACHE_RAMP.input]],
		] as const) {
			const h = (value / whole) * CACHE_ROW;
			if (h <= 0) continue;
			context.fillStyle = color ?? palette.muted;
			context.fillRect(x, y, w, h);
			y += h;
		}
		readLine.push([x, x + w, call.cacheRead]);
		if (call.miss) {
			const cx = x + w / 2;
			context.fillStyle = palette.error;
			context.beginPath();
			context.moveTo(cx - 4, missY + 1);
			context.lineTo(cx + 4, missY + 1);
			context.lineTo(cx, missY + MISS_ROW - 1);
			context.closePath();
			context.fill();
		}
	}
	if (readLine.length > 0) {
		context.beginPath();
		readLine.forEach(([x0, x1, value], at) => {
			const y = yOf(value, max);
			if (at === 0) context.moveTo(x0, y);
			else context.lineTo(x0, y);
			context.lineTo(x1, y);
		});
		context.strokeStyle = palette.text;
		context.lineWidth = 1;
		context.setLineDash([3, 2]);
		context.stroke();
		context.setLineDash([]);
	}

	const limitOf = new Map(data.limits.map((limit) => [limit.model, limit]));
	let runStart: number | null = null;
	let runLimit: number | null = null;
	let runApproximated = false;
	const flushLimit = (end: number) => {
		if (runStart === null || runLimit === null || runLimit > max) return;
		const y = Math.round(yOf(runLimit, max)) + 0.5;
		context.strokeStyle = palette.muted;
		context.setLineDash(runApproximated ? [2, 3] : [6, 3]);
		context.beginPath();
		context.moveTo(runStart, y);
		context.lineTo(end, y);
		context.stroke();
		context.setLineDash([]);
	};
	const from = Math.max(0, Math.floor(view.v0));
	const to = Math.min(calls.length - 1, Math.ceil(view.v1));
	for (let at = from; at <= to; at++) {
		const limit = limitOf.get(calls[at]?.model ?? "") ?? null;
		const value = limit?.value ?? null;
		if (value !== runLimit) {
			flushLimit(xOf(view, width, at - 0.5));
			runStart = xOf(view, width, at - 0.5);
			runLimit = value;
			runApproximated = limit?.origin === "approximated";
		}
	}
	flushLimit(xOf(view, width, to + 0.5));

	const offScale = data.limits.filter((limit) => limit.value > max);
	if (offScale.length > 0) {
		const label = text.offScale(
			[...new Set(offScale.map((limit) => limit.value))].sort((a, b) => a - b),
		);
		context.fillStyle = palette.muted;
		context.fillText(label, right - context.measureText(label).width - 4, TOP + 6);
	}
	const indexOf = new Map(calls.map((call, at) => [call.id, at]));
	context.lineWidth = 1;
	for (const change of data.switches) {
		const at = indexOf.get(change.at);
		if (at === undefined) continue;
		const x = Math.round(xOf(view, width, at - 0.5)) + 0.5;
		context.strokeStyle = palette.series["series-3"];
		context.setLineDash([4, 3]);
		context.beginPath();
		context.moveTo(x, TOP - 4);
		context.lineTo(x, cacheY + CACHE_ROW);
		context.stroke();
		context.setLineDash([]);
	}
	for (const cliff of data.compactions) {
		const at = cliff.after ? indexOf.get(cliff.after) : undefined;
		if (at === undefined) continue;
		const x = Math.round(xOf(view, width, at - 0.5)) + 0.5;
		context.strokeStyle = palette.series["series-7"];
		context.lineWidth = 1.5;
		context.beginPath();
		context.moveTo(x, TOP - 4);
		context.lineTo(x, cacheY + CACHE_ROW);
		context.stroke();
		context.lineWidth = 1;
	}

	const outline = (index: number | null, color: string, lineWidth: number) => {
		const call = index === null ? undefined : calls[index];
		if (!call || index === null || index < from || index > to) return;
		const perCall = plotWidth(width) / (view.v1 - view.v0);
		const w = Math.max(2, perCall - 1);
		const x = xOf(view, width, index) - w / 2;
		const y = yOf(call.total, max);
		context.strokeStyle = color;
		context.lineWidth = lineWidth;
		context.strokeRect(x - 1, y - 1, w + 2, TOP + BARS - y + 2);
		context.strokeRect(x - 1, cacheY - 1, w + 2, CACHE_ROW + 2);
		context.lineWidth = 1;
	};
	outline(state.hover?.index ?? null, palette.muted, 1);
	outline(state.selected, palette.text, 1.5);
	context.restore();

	context.fillStyle = palette.subtle;
	const span = view.v1 - view.v0;
	const every = Math.max(1, niceStep(span, plotWidth(width) / 70));
	for (let at = Math.ceil(Math.max(0, view.v0) / every) * every; at <= view.v1; at += every) {
		const call = calls[at];
		if (!call) continue;
		const label = text.call(call.n);
		const x = xOf(view, width, at);
		context.fillText(
			label,
			Math.min(right - context.measureText(label).width, x - 6),
			CHART_HEIGHT - AXIS / 2,
		);
	}

	const hover = state.hover;
	const hovered = hover ? calls[hover.index] : undefined;
	if (!hover || !hovered) return;
	const lines = text.tooltip(hovered);
	const lineHeight = 15;
	const boxWidth = Math.min(
		340,
		Math.max(...lines.map((line) => context.measureText(line).width)) + 14,
	);
	const boxHeight = lines.length * lineHeight + 8;
	const left = Math.min(width - boxWidth - 4, Math.max(4, hover.x + 12));
	const top = Math.max(2, Math.min(CHART_HEIGHT - boxHeight - 2, hover.y - boxHeight / 2));
	context.fillStyle = palette.canvas;
	context.globalAlpha = 0.96;
	context.fillRect(left, top, boxWidth, boxHeight);
	context.globalAlpha = 1;
	context.strokeStyle = palette.rule;
	context.strokeRect(left + 0.5, top + 0.5, boxWidth - 1, boxHeight - 1);
	lines.forEach((line, at) => {
		context.fillStyle = at === 0 ? palette.text : palette.muted;
		context.fillText(line, left + 7, top + 4 + lineHeight * at + lineHeight / 2, boxWidth - 12);
	});
}

/** The whole session in a strip (each pixel column's largest call) with the window as a brush. */
export function drawOverview(
	context: CanvasRenderingContext2D,
	width: number,
	data: SessionContext,
	view: ChartView,
	palette: Palette,
): void {
	const { calls } = data;
	context.clearRect(0, 0, width, OVERVIEW_HEIGHT);
	const full = fullView(calls.length);
	const max = Math.max(1, data.peak.value ?? 1);
	const columns = new Map<number, ContextCall>();
	calls.forEach((call, at) => {
		const x = Math.floor(xOf(full, width, at));
		const best = columns.get(x);
		if (!best || call.total > best.total) columns.set(x, call);
	});
	for (const [x, call] of columns) {
		const h = (call.total / max) * (OVERVIEW_HEIGHT - 6);
		context.fillStyle = call.miss ? palette.error : (palette.ramp[2] ?? palette.muted);
		context.fillRect(x, OVERVIEW_HEIGHT - 2 - h, 1, h);
	}
	const x0 = xOf(full, width, view.v0);
	const x1 = xOf(full, width, view.v1);
	context.fillStyle = palette.selected;
	context.globalAlpha = 0.45;
	context.fillRect(x0, 0, Math.max(2, x1 - x0), OVERVIEW_HEIGHT);
	context.globalAlpha = 1;
	context.strokeStyle = palette.focus;
	context.strokeRect(x0 + 0.5, 0.5, Math.max(2, x1 - x0) - 1, OVERVIEW_HEIGHT - 1);
}

/** A round tick step: 1, 2 or 5 × a power of ten, about `count` per `span`. */
export function niceStep(span: number, count: number): number {
	const raw = span / Math.max(1, count);
	if (raw <= 0) return 1;
	const power = 10 ** Math.floor(Math.log10(raw));
	const unit = raw / power;
	return (unit <= 1 ? 1 : unit <= 2 ? 2 : unit <= 5 ? 5 : 10) * power;
}

export { yOf };
