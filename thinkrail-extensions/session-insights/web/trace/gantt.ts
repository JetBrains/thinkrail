import type { SessionAnalysis } from "@thinkrail/pi-session-insights/core";
import {
	type BandPick,
	bandSteps,
	drawPlanRow,
	drawSkillRow,
	hitPlanRow,
	hitSkillRow,
} from "./bands";
import { type Frame, hitTest, layoutFrame, mergePixels, type PixelSpan, ROW_HEIGHT } from "./frame";
import { isFailure, runStart, seriesOf, type TraceModel } from "./model";
import type { Palette } from "./palette";
import { type AxisBreak, type TimeScale, tickMemo, type View } from "./scale";

/** Bands stacked above the axis: the overview, then the plan and skill bands when shown, then the axis. */
export interface HeaderBand {
	key: "overview" | "plan" | "skills" | "axis";
	height: number;
}

const OVERVIEW_BAND: HeaderBand = { key: "overview", height: 28 };
const AXIS_BAND: HeaderBand = { key: "axis", height: 22 };
export const BAND_HEIGHT = 18;
export const HEADER_BANDS: readonly HeaderBand[] = [OVERVIEW_BAND, AXIS_BAND];

export function headerBands(plan: boolean, skills: boolean): HeaderBand[] {
	return [
		OVERVIEW_BAND,
		...(plan ? [{ key: "plan", height: BAND_HEIGHT } as const] : []),
		...(skills ? [{ key: "skills", height: BAND_HEIGHT } as const] : []),
		AXIS_BAND,
	];
}

export function headerHeight(bands: readonly HeaderBand[]): number {
	return bands.reduce((sum, band) => sum + band.height, 0);
}

/** The band under a header point, with its top. */
export function bandAt(
	bands: readonly HeaderBand[],
	y: number,
): { band: HeaderBand; top: number } | null {
	let top = 0;
	for (const band of bands) {
		if (y >= top && y < top + band.height) return { band, top };
		top += band.height;
	}
	return null;
}

/** An arrow between two rows: spawn → the subagent's first row, its end → the call that read the result. */
export interface Flow {
	from: { index: number; t: number };
	to: { index: number; t: number };
	tone: "spawn" | "return";
}

export interface GanttText {
	font: string;
	time: (ms: number, seconds: boolean) => string;
	date: (ms: number) => string;
	breakLabel: (stretch: AxisBreak) => string;
	hover: (index: number) => string;
	band: (pick: BandPick) => string;
	hidden: (rows: number) => string;
}

export interface GanttState {
	model: TraceModel;
	rows: readonly number[];
	/** Folded runs of non-matching rows, by first event index. */
	runs: ReadonlyMap<number, number>;
	open: (index: number) => boolean;
	scale: TimeScale;
	view: View;
	selected: number;
	hits: ReadonlySet<number>;
	bands: readonly HeaderBand[];
	analysis: SessionAnalysis | null;
	pick: BandPick | null;
	/** Focus mode: rows outside are dimmed. */
	keep: Uint8Array | null;
	flows: readonly Flow[];
}

interface Size {
	width: number;
	height: number;
	ratio: number;
}

function sizeCanvas(canvas: HTMLCanvasElement, size: Size): CanvasRenderingContext2D | null {
	const width = Math.max(1, Math.round(size.width * size.ratio));
	const height = Math.max(1, Math.round(size.height * size.ratio));
	if (canvas.width !== width) canvas.width = width;
	if (canvas.height !== height) canvas.height = height;
	const context = canvas.getContext("2d");
	context?.setTransform(size.ratio, 0, 0, size.ratio, 0, 0);
	return context;
}

/** Local midnight, so day-long ticks fall on dates rather than UTC boundaries. */
function tickOffset(state: GanttState): number {
	return -new Date(state.scale.toTime(state.view.u0)).getTimezoneOffset() * 60_000;
}

function clipText(
	context: CanvasRenderingContext2D,
	text: string,
	x: number,
	y: number,
	max: number,
) {
	if (max < 12 || !text) return;
	let shown = text;
	if (context.measureText(shown).width > max) {
		let lo = 0;
		let hi = shown.length;
		while (lo < hi) {
			const mid = (lo + hi + 1) >> 1;
			if (context.measureText(`${text.slice(0, mid)}…`).width <= max) lo = mid;
			else hi = mid - 1;
		}
		shown = lo > 0 ? `${text.slice(0, lo)}…` : "";
	}
	if (shown) context.fillText(shown, x, y);
}

/**
 * The trace's canvases: the body (bars of the rows in view), an overlay for hover and selection that
 * redraws without the body, and the header (overview with its brush, then the axis). Plain class, driven
 * from effects; drawing is coalesced into one animation frame.
 */
export class GanttEngine {
	private readonly body: HTMLCanvasElement;
	private readonly overlay: HTMLCanvasElement;
	private readonly header: HTMLCanvasElement;
	private state: GanttState | null = null;
	private palette: Palette | null = null;
	private text: GanttText | null = null;
	private size: Size = { width: 0, height: 0, ratio: 1 };
	private scrollTop = 0;
	private hover: { row: number; x: number } | null = null;
	private bandHover: { x: number; pick: BandPick } | null = null;
	private frame: Frame | null = null;
	private overview: HTMLCanvasElement | null = null;
	private overviewKey = "";
	private pending = { body: false, overlay: false, header: false };
	private request = 0;
	private readonly ticks = tickMemo();

	constructor(body: HTMLCanvasElement, overlay: HTMLCanvasElement, header: HTMLCanvasElement) {
		this.body = body;
		this.overlay = overlay;
		this.header = header;
	}

	dispose(): void {
		if (this.request) cancelAnimationFrame(this.request);
		this.request = 0;
		this.state = null;
	}

	setState(state: GanttState): void {
		this.state = state;
		this.schedule(true, true, true);
	}

	setPalette(palette: Palette, text: GanttText): void {
		this.palette = palette;
		this.text = text;
		this.overviewKey = "";
		this.schedule(true, true, true);
	}

	setSize(width: number, height: number, ratio: number): void {
		this.size = { width, height, ratio };
		this.schedule(true, true, true);
	}

	setScroll(top: number): void {
		if (top === this.scrollTop) return;
		this.scrollTop = top;
		this.schedule(true, true, false);
	}

	setHover(hover: { row: number; x: number } | null): void {
		this.hover = hover;
		this.schedule(false, true, true);
	}

	setBandHover(hover: { x: number; pick: BandPick } | null): void {
		if (!hover && !this.bandHover) return;
		this.bandHover = hover;
		this.schedule(false, true, false);
	}

	hitAt(x: number, y: number) {
		return this.frame ? hitTest(this.frame, this.scrollTop, x, y) : null;
	}

	/** The plan step or skill under a point of the header, if a band is there. */
	bandHit(x: number, y: number): BandPick | null {
		const { state } = this;
		if (!state?.analysis) return null;
		const found = bandAt(state.bands, y);
		const xOf = (t: number) => this.x(state.scale.toUnit(t));
		if (found?.band.key === "plan") {
			const step = hitPlanRow(bandSteps(state.analysis), xOf, x);
			return step ? { kind: "step", id: step.id } : null;
		}
		if (found?.band.key === "skills") {
			const index = hitSkillRow(state.analysis.skills, xOf, x);
			return index === null ? null : { kind: "skill", index };
		}
		return null;
	}

	private schedule(body: boolean, overlay: boolean, header: boolean): void {
		this.pending.body ||= body;
		this.pending.overlay ||= overlay;
		this.pending.header ||= header;
		if (this.request) return;
		this.request = requestAnimationFrame(() => {
			this.request = 0;
			const due = this.pending;
			this.pending = { body: false, overlay: false, header: false };
			if (due.body) this.drawBody();
			if (due.overlay) this.drawOverlay();
			if (due.header) this.drawHeader();
		});
	}

	private x(unit: number): number {
		const view = this.state?.view;
		if (!view) return 0;
		return ((unit - view.u0) / (view.u1 - view.u0)) * this.size.width;
	}

	private drawBody(): void {
		const { state, palette, text } = this;
		const context = sizeCanvas(this.body, this.size);
		if (!context || !state || !palette || !text) return;
		const { width, height } = this.size;
		context.clearRect(0, 0, width, height);
		this.frame = layoutFrame({ ...state, width, height, scrollTop: this.scrollTop });
		const frame = this.frame;
		context.fillStyle = palette.grid;
		for (const gap of state.scale.breaks) {
			const x0 = this.x(gap.u0);
			const x1 = this.x(gap.u1);
			if (x1 < 0 || x0 > width) continue;
			context.globalAlpha = 0.35;
			context.fillRect(x0, 0, x1 - x0, height);
			context.globalAlpha = 1;
		}
		for (const tick of this.ticks(state.scale, state.view, width, tickOffset(state)))
			context.fillRect(Math.round(tick.x), 0, 1, height);
		context.font = text.font;
		context.textBaseline = "middle";
		const first = Math.max(0, Math.floor(this.scrollTop / ROW_HEIGHT));
		const last = Math.min(state.rows.length, Math.ceil((this.scrollTop + height) / ROW_HEIGHT) + 1);
		for (let row = first; row < last; row++) {
			const value = state.rows[row];
			if (value === undefined || value >= 0) continue;
			const y = row * ROW_HEIGHT - this.scrollTop;
			context.fillStyle = palette.grid;
			context.globalAlpha = 0.4;
			context.fillRect(0, y + 2, width, ROW_HEIGHT - 4);
			context.globalAlpha = 1;
			context.fillStyle = palette.subtle;
			clipText(
				context,
				text.hidden(state.runs.get(runStart(value)) ?? 0),
				8,
				y + ROW_HEIGHT / 2,
				width - 16,
			);
		}
		for (const bar of frame.bars) {
			const y = bar.row * ROW_HEIGHT - this.scrollTop;
			context.globalAlpha = 0.6;
			context.fillStyle = palette.grid;
			context.fillRect(0, y + ROW_HEIGHT - 1, width, 1);
			context.globalAlpha = 1;
			const fade = state.keep !== null && !state.keep[bar.event] ? 0.28 : 1;
			context.globalAlpha = fade;
			if (state.hits.has(bar.event)) {
				context.globalAlpha = 0.18 * fade;
				context.fillStyle = palette.warning;
				context.fillRect(0, y, width, ROW_HEIGHT);
				context.globalAlpha = fade;
			}
			const color = bar.error
				? palette.error
				: bar.series
					? palette.series[bar.series]
					: palette.muted;
			const top = y + 6;
			const tall = ROW_HEIGHT - 12;
			const middle = y + ROW_HEIGHT / 2;
			switch (bar.shape) {
				case "extent": {
					const event = state.model.at(bar.event);
					const fill = event?.kind === "turn" ? palette.series.primary : color;
					context.fillStyle = fill;
					context.globalAlpha = 0.14 * fade;
					context.fillRect(bar.x0, y + 4, Math.max(2, bar.x1 - bar.x0), ROW_HEIGHT - 8);
					context.globalAlpha = 0.8 * fade;
					context.fillRect(bar.x0, y + 4, Math.max(2, bar.x1 - bar.x0), 2);
					context.globalAlpha = fade;
					if (event?.kind === "turn")
						context.fillRect(Math.round(bar.x0), y + 3, 2, ROW_HEIGHT - 6);
					break;
				}
				case "point": {
					context.fillStyle = color;
					context.beginPath();
					context.moveTo(bar.x0, y + 6);
					context.lineTo(bar.x0 + 4, middle);
					context.lineTo(bar.x0, y + ROW_HEIGHT - 6);
					context.lineTo(bar.x0 - 4, middle);
					context.closePath();
					context.fill();
					break;
				}
				case "missing": {
					context.strokeStyle = palette.error;
					context.setLineDash([3, 3]);
					context.beginPath();
					context.moveTo(bar.x0, middle);
					context.lineTo(Math.min(width, bar.x0 + 48), middle);
					context.stroke();
					context.setLineDash([]);
					context.fillStyle = palette.error;
					context.fillRect(bar.x0 - 1, top, 2, tall);
					break;
				}
				case "span": {
					const w = Math.max(1, bar.x1 - bar.x0);
					context.fillStyle = color;
					context.globalAlpha = (bar.error ? 0.55 : 1) * fade;
					context.fillRect(bar.x0, top, w, tall);
					context.globalAlpha = fade;
					if (bar.error) {
						context.strokeStyle = palette.error;
						context.strokeRect(bar.x0 + 0.5, top + 0.5, Math.max(0, w - 1), tall - 1);
					}
					if (bar.approximate && w > 4) {
						context.strokeStyle = palette.canvas;
						context.setLineDash([2, 2]);
						context.strokeRect(bar.x0 + 0.5, top + 0.5, w - 1, tall - 1);
						context.setLineDash([]);
					}
					if (w > 48 && bar.label) {
						context.fillStyle = bar.error ? palette.text : palette.canvas;
						clipText(
							context,
							bar.label,
							Math.max(bar.x0, 0) + 4,
							middle,
							Math.min(bar.x1, width) - Math.max(bar.x0, 0) - 8,
						);
					}
					break;
				}
			}
			context.globalAlpha = 1;
		}
		for (const tick of frame.ticks) {
			const y = tick.row * ROW_HEIGHT - this.scrollTop;
			context.fillStyle = tick.error ? palette.error : palette.series[tick.series];
			context.fillRect(tick.x, y + 9, tick.width, ROW_HEIGHT - 16);
		}
	}

	private drawOverlay(): void {
		const { state, palette, text } = this;
		const context = sizeCanvas(this.overlay, this.size);
		if (!context || !state || !palette || !text) return;
		const { width, height } = this.size;
		context.clearRect(0, 0, width, height);
		const hoverRow = this.hover?.row ?? -1;
		if (hoverRow >= 0) {
			context.globalAlpha = 0.5;
			context.fillStyle = palette.selected;
			context.fillRect(0, hoverRow * ROW_HEIGHT - this.scrollTop, width, ROW_HEIGHT);
			context.globalAlpha = 1;
		}
		const selectedRow = state.rows.indexOf(state.selected);
		const event = state.model.at(state.selected);
		if (selectedRow >= 0 && event) {
			const y = selectedRow * ROW_HEIGHT - this.scrollTop;
			context.globalAlpha = 0.6;
			context.fillStyle = palette.selected;
			context.fillRect(0, y, width, ROW_HEIGHT);
			context.globalAlpha = 1;
			const x0 = this.x(state.scale.toUnit(event.t0));
			const x1 = Math.max(x0, this.x(state.scale.toUnit(event.t1)));
			context.strokeStyle = palette.focus;
			context.lineWidth = 1.5;
			context.strokeRect(x0 - 2.5, y + 2.5, Math.max(4, x1 - x0) + 5, ROW_HEIGHT - 5);
			context.lineWidth = 1;
		}
		this.drawFlows(context, state, palette);
		if (this.bandHover) {
			const label = text.band(this.bandHover.pick);
			context.font = text.font;
			context.textBaseline = "middle";
			const w = Math.min(width - 4, context.measureText(label).width + 12);
			const left = Math.min(width - w - 2, Math.max(2, this.bandHover.x - w / 2));
			context.fillStyle = palette.canvas;
			context.globalAlpha = 0.96;
			context.fillRect(left, 2, w, 20);
			context.globalAlpha = 1;
			context.strokeStyle = palette.rule;
			context.strokeRect(left + 0.5, 2.5, w - 1, 19);
			context.fillStyle = palette.text;
			clipText(context, label, left + 6, 12, w - 12);
		}
		if (this.hover) {
			context.fillStyle = palette.muted;
			context.globalAlpha = 0.5;
			context.fillRect(Math.round(this.hover.x), 0, 1, height);
			context.globalAlpha = 1;
			const index = state.rows[this.hover.row];
			if (index !== undefined) {
				const label = text.hover(index);
				context.font = text.font;
				context.textBaseline = "middle";
				const w = context.measureText(label).width + 12;
				const top = Math.min(
					height - 22,
					this.hover.row * ROW_HEIGHT - this.scrollTop + ROW_HEIGHT + 2,
				);
				const left = Math.min(width - w - 2, Math.max(2, this.hover.x + 8));
				context.fillStyle = palette.canvas;
				context.globalAlpha = 0.94;
				context.fillRect(left, top, w, 20);
				context.globalAlpha = 1;
				context.strokeStyle = palette.rule;
				context.strokeRect(left + 0.5, top + 0.5, w - 1, 19);
				context.fillStyle = palette.text;
				context.fillText(label, left + 6, top + 10);
			}
		}
	}

	/** Arrows between rows in view: a curve from one bar's point to another's, with a head. */
	private drawFlows(context: CanvasRenderingContext2D, state: GanttState, palette: Palette): void {
		for (const flow of state.flows) {
			const fromRow = state.rows.indexOf(flow.from.index);
			const toRow = state.rows.indexOf(flow.to.index);
			if (fromRow < 0 || toRow < 0) continue;
			const x0 = this.x(state.scale.toUnit(flow.from.t));
			const x1 = this.x(state.scale.toUnit(flow.to.t));
			const y0 = fromRow * ROW_HEIGHT - this.scrollTop + ROW_HEIGHT / 2;
			const y1 = toRow * ROW_HEIGHT - this.scrollTop + ROW_HEIGHT / 2;
			context.strokeStyle = flow.tone === "spawn" ? palette.series["series-6"] : palette.success;
			context.fillStyle = context.strokeStyle;
			context.lineWidth = 1.5;
			context.setLineDash(flow.tone === "return" ? [4, 3] : []);
			context.beginPath();
			context.moveTo(x0, y0);
			const bend = Math.max(12, Math.abs(y1 - y0) / 2);
			context.bezierCurveTo(x0 + bend / 2, y0, x1 - bend, y1, x1 - 4, y1);
			context.stroke();
			context.setLineDash([]);
			context.beginPath();
			context.moveTo(x1, y1);
			context.lineTo(x1 - 6, y1 - 3.5);
			context.lineTo(x1 - 6, y1 + 3.5);
			context.closePath();
			context.fill();
			context.lineWidth = 1;
		}
	}

	private overviewImage(width: number, height: number): HTMLCanvasElement | null {
		const { state, palette } = this;
		if (!state || !palette) return null;
		const key = `${width}:${height}:${this.size.ratio}:${state.model.size}:${state.scale.min}:${state.scale.max}:${state.scale.breaks.length}`;
		if (this.overview && this.overviewKey === key) return this.overview;
		const image = this.overview ?? document.createElement("canvas");
		const context = sizeCanvas(image, { width, height, ratio: this.size.ratio });
		if (!context) return null;
		context.clearRect(0, 0, width, height);
		const span = state.scale.max - state.scale.min || 1;
		const xOf = (time: number) => ((state.scale.toUnit(time) - state.scale.min) / span) * width;
		const columns = Math.ceil(width);
		const counts = new Uint16Array(columns);
		const tools: PixelSpan[] = [];
		const calls: PixelSpan[] = [];
		for (const event of state.model.events) {
			const series = seriesOf(event);
			if (!series || (event.kind !== "llm" && event.kind !== "tool")) continue;
			const x0 = xOf(event.t0);
			const x1 = Math.max(x0 + 2, xOf(event.t1));
			const span = { x0, x1, series, error: isFailure(event) };
			if (event.kind === "llm") calls.push(span);
			else {
				tools.push(span);
				const column = Math.min(columns - 1, Math.max(0, Math.floor(x0)));
				counts[column] = (counts[column] ?? 0) + 1;
			}
		}
		const peak = Math.max(1, ...counts);
		const steps = palette.ramp.length;
		counts.forEach((count, x) => {
			if (count === 0) return;
			const step = Math.min(steps - 1, Math.floor(Math.sqrt(count / peak) * steps - 1e-9));
			context.fillStyle = palette.ramp[Math.max(0, step)] ?? palette.muted;
			context.fillRect(Math.max(0, x - 1), 3, 3, 4);
		});
		for (const run of mergePixels(tools, width)) {
			context.fillStyle = run.error ? palette.error : palette.series[run.series];
			context.fillRect(run.x, 9, run.width, height - 17);
		}
		for (const run of mergePixels(calls, width)) {
			context.fillStyle = run.error ? palette.error : palette.series[run.series];
			context.fillRect(run.x, height - 6, run.width, 3);
		}
		this.overview = image;
		this.overviewKey = key;
		return image;
	}

	private drawHeader(): void {
		const { state, palette, text } = this;
		const total = state ? headerHeight(state.bands) : 0;
		const context = sizeCanvas(this.header, { ...this.size, height: total });
		if (!context || !state || !palette || !text) return;
		const { width } = this.size;
		context.clearRect(0, 0, width, total);
		context.font = text.font;
		context.textBaseline = "middle";
		const xOf = (t: number) => this.x(state.scale.toUnit(t));
		const pick = state.pick;
		let top = 0;
		for (const band of state.bands) {
			if (band.key === "overview") this.drawOverview(context, top, band.height);
			else if (band.key === "axis") this.drawAxis(context, top, band.height);
			else if (band.key === "plan")
				drawPlanRow(
					context,
					bandSteps(state.analysis),
					xOf,
					top,
					band.height,
					width,
					palette,
					pick?.kind === "step" ? pick.id : null,
				);
			else
				drawSkillRow(
					context,
					state.analysis?.skills ?? [],
					xOf,
					top,
					band.height,
					width,
					palette,
					pick?.kind === "skill" ? pick.index : null,
				);
			top += band.height;
			context.fillStyle = palette.rule;
			context.fillRect(0, top - 1, width, 1);
		}
		if (this.hover) {
			context.fillStyle = palette.muted;
			context.fillRect(Math.round(this.hover.x), state.bands[0]?.height ?? 0, 1, total);
		}
	}

	private drawOverview(context: CanvasRenderingContext2D, top: number, height: number): void {
		const { state, palette } = this;
		if (!state || !palette) return;
		const { width } = this.size;
		const image = this.overviewImage(width, height);
		if (image) context.drawImage(image, 0, top, width, height);
		const span = state.scale.max - state.scale.min || 1;
		const brush0 = Math.max(0, ((state.view.u0 - state.scale.min) / span) * width);
		const brush1 = Math.min(width, ((state.view.u1 - state.scale.min) / span) * width);
		context.fillStyle = palette.canvas;
		context.globalAlpha = 0.55;
		context.fillRect(0, top, brush0, height);
		context.fillRect(brush1, top, width - brush1, height);
		context.globalAlpha = 1;
		context.strokeStyle = palette.focus;
		context.strokeRect(
			Math.round(brush0) + 0.5,
			top + 0.5,
			Math.max(2, Math.round(brush1 - brush0) - 1),
			height - 2,
		);
		context.fillStyle = palette.focus;
		context.fillRect(Math.round(brush0) - 1, top + 8, 3, height - 16);
		context.fillRect(Math.round(brush1) - 2, top + 8, 3, height - 16);
	}

	private drawAxis(context: CanvasRenderingContext2D, top: number, height: number): void {
		const { state, palette, text } = this;
		if (!state || !palette || !text) return;
		const { width } = this.size;
		context.font = text.font;
		context.textBaseline = "middle";
		for (const tick of this.ticks(state.scale, state.view, width, tickOffset(state))) {
			if (tick.x < 0 || tick.x > width) continue;
			context.fillStyle = palette.rule;
			context.fillRect(Math.round(tick.x), top + height - 5, 1, 5);
			const label = tick.day
				? `${text.date(tick.time)} ${text.time(tick.time, tick.seconds)}`
				: text.time(tick.time, tick.seconds);
			context.fillStyle = tick.day ? palette.muted : palette.subtle;
			context.fillText(label, tick.x + 3, top + height / 2 - 1);
		}
		for (const gap of state.scale.breaks) {
			const x0 = this.x(gap.u0);
			const x1 = this.x(gap.u1);
			if (x1 < 0 || x0 > width) continue;
			context.fillStyle = palette.grid;
			context.fillRect(x0, top, x1 - x0, height);
			const middle = (x0 + x1) / 2;
			context.strokeStyle = palette.subtle;
			context.beginPath();
			context.moveTo(middle - 4, top + height - 2);
			context.lineTo(middle - 1, top + height - 8);
			context.moveTo(middle + 1, top + height - 2);
			context.lineTo(middle + 4, top + height - 8);
			context.stroke();
			const label = text.breakLabel(gap);
			const w = context.measureText(label).width;
			if (x1 - x0 > w + 6) {
				context.fillStyle = gap.cause === "user" ? palette.series.primary : palette.muted;
				context.fillText(label, middle - w / 2, top + height / 2 - 1);
			}
		}
	}
}
