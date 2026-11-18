import type {
	ContextLimit,
	Interval,
	PlanStep,
	SessionAnalysis,
	SessionTimeline,
	SpendPoint,
	WaitActor,
} from "@thinkrail/pi-session-insights/core";
import { type BandPick, check, drawSkillRow } from "../trace/bands";
import { mergePixels, type PixelSpan } from "../trace/frame";
import { FAMILY_SERIES, isFailure, LLM_SERIES, type TraceModel } from "../trace/model";
import type { Palette } from "../trace/palette";
import { type AxisScale, stepTicks, tickMemo, type View } from "../trace/scale";
import {
	GUTTER,
	type Lane,
	type LaneLayout,
	plotWidth,
	plotX,
	type TimelineHit,
	type TimelineItem,
	type TimelineItems,
	WAIT_SERIES,
	windowRuns,
} from "./layout";

export const OVERVIEW_HEIGHT = 30;
export const AXIS_HEIGHT = 22;
export const HEADER_HEIGHT = OVERVIEW_HEIGHT + AXIS_HEIGHT;

export type AxisMode = "time" | "steps";

export interface TimelineState {
	model: TraceModel;
	timeline: SessionTimeline;
	items: TimelineItems;
	layout: LaneLayout;
	scale: AxisScale;
	mode: AxisMode;
	view: View;
	selected: number;
	analysis: SessionAnalysis | null;
	/** A picked plan step or skill: items outside its stretches are dimmed. */
	pick: BandPick | null;
	highlight: readonly Interval[] | null;
	/** Start times of failed calls, sorted, for the plan rows' error ticks. */
	failures: readonly number[];
}

export interface TimelineText {
	font: string;
	time: (ms: number, seconds: boolean) => string;
	date: (ms: number) => string;
	step: (n: number) => string;
	lane: (lane: Lane) => [string, string | null];
	turn: (n: number) => string;
	tooltip: (hit: TimelineHit) => string[];
	limit: (limit: ContextLimit) => string;
	peak: (tokens: number) => string;
	spend: () => string;
	noSubagents: string;
	breakLabel: (t0: number, t1: number) => string;
	stepSpend: (step: PlanStep) => string;
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

function localOffset(time: number): number {
	return -new Date(time).getTimezoneOffset() * 60_000;
}

/**
 * The timeline's canvases: the body (lanes and counters), an overlay for hover, selection and the
 * tooltip, and the header (overview with its brush, then the axis). A plain class driven from effects;
 * drawing is coalesced into one animation frame.
 */
export class TimelineEngine {
	private readonly body: HTMLCanvasElement;
	private readonly overlay: HTMLCanvasElement;
	private readonly header: HTMLCanvasElement;
	private state: TimelineState | null = null;
	private palette: Palette | null = null;
	private text: TimelineText | null = null;
	private size: Size = { width: 0, height: 0, ratio: 1 };
	private hover: { x: number; y: number; hit: TimelineHit | null } | null = null;
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

	setState(state: TimelineState): void {
		this.state = state;
		this.schedule(true, true, true);
	}

	setPalette(palette: Palette, text: TimelineText): void {
		this.palette = palette;
		this.text = text;
		this.overviewKey = "";
		this.schedule(true, true, true);
	}

	setSize(width: number, height: number, ratio: number): void {
		this.size = { width, height, ratio };
		this.schedule(true, true, true);
	}

	setHover(hover: { x: number; y: number; hit: TimelineHit | null } | null): void {
		this.hover = hover;
		this.schedule(false, true, true);
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

	private x(time: number): number {
		const state = this.state;
		if (!state) return 0;
		return plotX(state.view, this.size.width, state.scale.toUnit(time));
	}

	private drawBody(): void {
		const { state, palette, text } = this;
		const context = sizeCanvas(this.body, this.size);
		if (!context || !state || !palette || !text) return;
		const { width, height } = this.size;
		context.clearRect(0, 0, width, height);
		context.font = text.font;
		context.textBaseline = "middle";
		const right = GUTTER + plotWidth(width);
		context.save();
		context.beginPath();
		context.rect(GUTTER, 0, right - GUTTER, height);
		context.clip();
		this.drawGrid(context, state, palette, height);
		for (const lane of state.layout.lanes) {
			switch (lane.key) {
				case "band":
					this.drawBand(context, state, palette, lane);
					break;
				case "user":
					this.drawUser(context, state, palette, text, lane);
					break;
				case "model":
					this.drawSpans(context, state, palette, text, lane);
					break;
				case "tools":
				case "subagents":
					this.drawSpans(context, state, palette, text, lane);
					break;
				case "context":
					this.drawContext(context, state, palette, text, lane);
					break;
				case "spend":
					this.drawSpend(context, state, palette, text, lane);
					break;
				case "skills":
					drawSkillRow(
						context,
						state.analysis?.skills ?? [],
						(t) => this.x(t),
						lane.y,
						lane.height,
						width,
						palette,
						state.pick?.kind === "skill" ? state.pick.index : null,
					);
					break;
				case "plan":
					this.drawStep(context, state, palette, text, lane);
					break;
			}
		}
		context.restore();
		context.fillStyle = palette.grid;
		context.globalAlpha = 0.35;
		context.fillRect(0, 0, GUTTER - 1, height);
		context.globalAlpha = 1;
		context.fillStyle = palette.rule;
		context.fillRect(GUTTER - 1, 0, 1, height);
		for (const lane of state.layout.lanes) {
			const [label, sub] = text.lane(lane);
			const top = lane.y + Math.min(lane.height, 26) / 2;
			const picked =
				lane.key === "plan" &&
				state.pick?.kind === "step" &&
				state.analysis?.plan?.steps[lane.step]?.id === state.pick.id;
			context.fillStyle = picked
				? palette.focus
				: lane.key === "band" || lane.key === "plan"
					? palette.subtle
					: palette.muted;
			clipText(context, label, 8, sub ? top - 5 : top, GUTTER - 14);
			if (sub) {
				context.fillStyle = palette.subtle;
				clipText(context, sub, 8, top + 8, GUTTER - 14);
			}
			if (lane.key !== "band" && lane.key !== "plan") {
				context.fillStyle = palette.grid;
				context.fillRect(0, lane.y + lane.height - 0.5, width, 1);
			}
		}
	}

	private drawGrid(
		context: CanvasRenderingContext2D,
		state: TimelineState,
		palette: Palette,
		height: number,
	): void {
		const { width } = this.size;
		const plot = plotWidth(width);
		context.fillStyle = palette.grid;
		context.globalAlpha = 0.6;
		if (state.mode === "steps")
			for (const tick of stepTicks(state.view, plot))
				context.fillRect(Math.round(GUTTER + tick.x), 0, 1, height);
		else
			for (const tick of this.ticks(
				state.scale,
				state.view,
				plot,
				localOffset(state.scale.toTime(state.view.u0)),
			))
				context.fillRect(Math.round(GUTTER + tick.x), 0, 1, height);
		context.globalAlpha = 1;
		for (const gap of state.scale.breaks) {
			const x0 = plotX(state.view, width, gap.u0);
			const x1 = plotX(state.view, width, gap.u1);
			if (x1 < GUTTER || x0 > width) continue;
			context.fillStyle = palette.grid;
			context.globalAlpha = 0.45;
			context.fillRect(x0, 0, x1 - x0, height);
			context.globalAlpha = 1;
			context.strokeStyle = palette.subtle;
			context.setLineDash([2, 3]);
			context.beginPath();
			context.moveTo(Math.round(x0) + 0.5, 0);
			context.lineTo(Math.round(x0) + 0.5, height);
			context.moveTo(Math.round(x1) - 0.5, 0);
			context.lineTo(Math.round(x1) - 0.5, height);
			context.stroke();
			context.setLineDash([]);
		}
		for (const item of state.items.track("user", 0)) {
			if (!item.point) continue;
			const x = Math.round(this.x(item.t0));
			context.fillStyle = palette.series.primary;
			context.globalAlpha = 0.12;
			context.fillRect(x, 0, 1, height);
			context.globalAlpha = 1;
		}
		for (const event of state.model.events) {
			if (event.kind !== "mark" || (event.mark !== "compaction" && event.mark !== "modelChange"))
				continue;
			const x = Math.round(this.x(event.t0)) + 0.5;
			context.strokeStyle =
				event.mark === "compaction" ? palette.series["series-1"] : palette.series["series-3"];
			context.setLineDash(event.mark === "modelChange" ? [4, 3] : []);
			context.globalAlpha = 0.8;
			context.beginPath();
			context.moveTo(x, 0);
			context.lineTo(x, height);
			context.stroke();
			context.setLineDash([]);
			context.globalAlpha = 1;
		}
	}

	private drawBand(
		context: CanvasRenderingContext2D,
		state: TimelineState,
		palette: Palette,
		lane: Lane,
	): void {
		const top = lane.y + 3;
		const tall = lane.height - 6;
		const spans: { x0: number; x1: number; actor: WaitActor }[] = [];
		for (const band of state.timeline.bands) {
			const x0 = this.x(band.t0);
			const x1 = this.x(band.t1);
			if (x1 < GUTTER || x0 > this.size.width) continue;
			spans.push({ x0, x1: Math.max(x0 + 0.6, x1), actor: band.actor });
		}
		for (const span of spans) {
			const series = WAIT_SERIES[span.actor];
			context.fillStyle = series ? palette.series[series] : palette.rule;
			context.globalAlpha = series ? 0.9 : 0.6;
			context.fillRect(span.x0, top, span.x1 - span.x0, tall);
		}
		context.globalAlpha = 1;
	}

	private drawUser(
		context: CanvasRenderingContext2D,
		state: TimelineState,
		palette: Palette,
		text: TimelineText,
		lane: Lane,
	): void {
		context.fillStyle = palette.series.primary;
		context.globalAlpha = 0.07;
		for (const band of state.timeline.bands) {
			if (band.actor !== "user") continue;
			const x0 = this.x(band.t0);
			const x1 = this.x(band.t1);
			if (x1 < GUTTER || x0 > this.size.width) continue;
			context.fillRect(x0, lane.y + 4, Math.max(0.5, x1 - x0), lane.height - 8);
		}
		context.globalAlpha = 1;
		let lastLabel = Number.NEGATIVE_INFINITY;
		for (const item of state.items.track("user", 0)) {
			const event = state.model.at(item.index);
			if (!event) continue;
			const x0 = this.x(item.t0);
			if (!item.point) {
				const x1 = Math.max(x0 + 2, this.x(item.t1));
				if (x1 < GUTTER || x0 > this.size.width) continue;
				context.fillStyle = palette.series.primary;
				context.globalAlpha = 0.25;
				context.fillRect(x0, lane.y + 6, x1 - x0, lane.height - 12);
				context.globalAlpha = 1;
				context.strokeStyle = palette.series.primary;
				context.strokeRect(x0 + 0.5, lane.y + 6.5, x1 - x0 - 1, lane.height - 13);
				continue;
			}
			if (x0 < GUTTER - 10 || x0 > this.size.width + 10) continue;
			const prompted = event.kind === "turn" && event.trigger === "prompt";
			context.fillStyle = prompted ? palette.series.primary : palette.muted;
			context.fillRect(Math.round(x0), lane.y + 3, 1.5, lane.height - 6);
			context.beginPath();
			context.moveTo(x0, lane.y + 3);
			context.lineTo(x0 + 7, lane.y + 6.5);
			context.lineTo(x0, lane.y + 10);
			context.closePath();
			context.fill();
			if (event.kind === "turn" && x0 - lastLabel > 26) {
				clipText(context, text.turn(event.n), x0 + 3, lane.y + lane.height - 7, 40);
				lastLabel = x0;
			}
		}
	}

	private drawSpans(
		context: CanvasRenderingContext2D,
		state: TimelineState,
		palette: Palette,
		text: TimelineText,
		lane: Lane,
	): void {
		const key = lane.key === "model" ? "model" : lane.key === "tools" ? "tools" : "subagents";
		if (key === "subagents" && lane.tracks === 0) {
			context.fillStyle = palette.subtle;
			clipText(
				context,
				text.noSubagents,
				GUTTER + 8,
				lane.y + lane.height / 2,
				plotWidth(this.size.width) - 16,
			);
			return;
		}
		const { width } = this.size;
		for (let track = 0; track < Math.max(1, lane.tracks); track++) {
			const top = key === "model" ? lane.y + 5 : lane.y + 3 + track * lane.trackHeight;
			const tall = key === "model" ? lane.height - 10 : lane.trackHeight - 3;
			const narrow: PixelSpan[] = [];
			for (const item of state.items.track(key, track)) {
				const event = state.model.at(item.index);
				if (!event) continue;
				const x0 = this.x(item.t0);
				const x1 = Math.max(x0, this.x(item.t1));
				if (x1 < GUTTER - 1 || x0 > width) continue;
				const series =
					event.kind === "tool"
						? FAMILY_SERIES[event.family]
						: event.kind === "subagent"
							? FAMILY_SERIES.subagent
							: LLM_SERIES;
				const failed = isFailure(event) || (event.kind === "subagent" && event.error === true);
				const dim =
					state.highlight !== null &&
					!state.highlight.some((span) => item.t0 >= span.t0 && item.t0 <= span.t1);
				if (dim) {
					context.fillStyle = palette.grid;
					context.fillRect(x0, top, Math.max(1, x1 - x0), tall);
					continue;
				}
				if (x1 - x0 < 3) {
					narrow.push({ x0, x1: Math.max(x1, x0 + 1), series, error: failed });
					continue;
				}
				context.fillStyle = failed ? palette.error : palette.series[series];
				context.globalAlpha = failed ? 0.55 : 1;
				context.fillRect(x0, top, x1 - x0, tall);
				context.globalAlpha = 1;
				if (failed) {
					context.strokeStyle = palette.error;
					context.strokeRect(x0 + 0.5, top + 0.5, x1 - x0 - 1, tall - 1);
				}
				if (event.timing === "approximated" && x1 - x0 > 4) {
					context.strokeStyle = palette.canvas;
					context.setLineDash([2, 2]);
					context.strokeRect(x0 + 0.5, top + 0.5, x1 - x0 - 1, tall - 1);
					context.setLineDash([]);
				}
				if (x1 - x0 > 46 && tall >= 10) {
					const label =
						event.kind === "tool"
							? (event.head ?? event.tool)
							: event.kind === "subagent"
								? (event.role ?? "")
								: event.kind === "llm"
									? (event.model?.split("/").pop() ?? "")
									: "";
					context.fillStyle = failed ? palette.text : palette.canvas;
					clipText(
						context,
						label,
						Math.max(x0, GUTTER) + 4,
						top + tall / 2 + 0.5,
						Math.min(x1, width) - Math.max(x0, GUTTER) - 8,
					);
				}
			}
			for (const run of mergePixels(narrow, width)) {
				context.fillStyle = run.error ? palette.error : palette.series[run.series];
				context.fillRect(run.x, top, run.width, tall);
			}
		}
	}

	/** One plan step: pending as a dashed line, in progress as bars, done as a check, failures as ticks. */
	private drawStep(
		context: CanvasRenderingContext2D,
		state: TimelineState,
		palette: Palette,
		text: TimelineText,
		lane: Lane,
	): void {
		const step = state.analysis?.plan?.steps[lane.step];
		if (!step) return;
		const middle = lane.y + lane.height / 2;
		const picked = state.pick?.kind === "step" && state.pick.id === step.id;
		if (picked) {
			context.fillStyle = palette.selected;
			context.globalAlpha = 0.6;
			context.fillRect(GUTTER, lane.y, this.size.width - GUTTER, lane.height);
			context.globalAlpha = 1;
		}
		const closed = step.changes.find(
			(change) =>
				change.status === "done" || change.status === "removed" || change.status === "promoted",
		);
		const firstWork =
			step.active[0]?.t0 ?? closed?.t ?? state.timeline.end ?? step.changes.at(-1)?.t ?? step.first;
		const x0 = this.x(step.first);
		const x1 = this.x(firstWork);
		context.strokeStyle = palette.muted;
		context.setLineDash(step.listedOnly ? [1, 3] : [3, 3]);
		context.beginPath();
		context.moveTo(x0, middle + 0.5);
		context.lineTo(Math.max(x0 + 2, x1), middle + 0.5);
		context.stroke();
		context.setLineDash([]);
		const top = lane.y + 3;
		const tall = lane.height - 6;
		for (const span of step.active) {
			const a = this.x(span.t0);
			const b = Math.max(a + 2, this.x(span.t1));
			context.fillStyle = palette.series["series-7"];
			context.fillRect(a, top, b - a, tall);
			for (const at of state.failures) {
				if (at < span.t0 || at > span.t1) continue;
				const x = this.x(at);
				context.fillStyle = palette.error;
				context.fillRect(Math.round(x), lane.y, 2, 4);
			}
		}
		for (const change of step.changes) {
			const x = this.x(change.t);
			if (change.status === "done") {
				context.strokeStyle = palette.success;
				context.lineWidth = 1.5;
				check(context, x + 4, middle);
				context.lineWidth = 1;
			} else if (change.status === "removed") {
				context.strokeStyle = palette.muted;
				context.beginPath();
				context.moveTo(x - 3, middle - 3);
				context.lineTo(x + 3, middle + 3);
				context.moveTo(x + 3, middle - 3);
				context.lineTo(x - 3, middle + 3);
				context.stroke();
			}
		}
		const label = text.stepSpend(step);
		const w = context.measureText(label).width;
		const right = GUTTER + plotWidth(this.size.width);
		context.fillStyle = palette.canvas;
		context.globalAlpha = 0.85;
		context.fillRect(right - w - 8, lane.y + 1, w + 6, lane.height - 2);
		context.globalAlpha = 1;
		context.fillStyle = step.errors.value ? palette.error : palette.subtle;
		context.fillText(label, right - w - 5, middle + 0.5);
	}

	private contextMax(state: TimelineState): number {
		let peak = 0;
		for (const point of state.timeline.context) peak = Math.max(peak, point.tokens);
		let limit = 0;
		for (const item of state.timeline.limits) limit = Math.max(limit, item.value);
		return Math.max(peak, limit > 0 && limit < peak * 4 ? limit : 0) * 1.08 || 1;
	}

	private drawContext(
		context: CanvasRenderingContext2D,
		state: TimelineState,
		palette: Palette,
		text: TimelineText,
		lane: Lane,
	): void {
		const points = state.timeline.context;
		if (points.length === 0) return;
		const max = this.contextMax(state);
		const y = (value: number) => lane.y + lane.height - 4 - (value / max) * (lane.height - 12);
		const coords: { x: number; y: number; miss: boolean; model: string }[] = [];
		let peak = 0;
		for (const point of points) {
			const event = state.model.at(state.model.indexOf(point.id));
			if (!event) continue;
			coords.push({
				x: this.x(event.t0),
				y: y(point.tokens),
				miss: point.miss === true,
				model: event.kind === "llm" ? (event.model ?? "") : "",
			});
			peak = Math.max(peak, point.tokens);
		}
		if (coords.length === 0) return;
		const right = Math.min(this.size.width, (coords.at(-1)?.x ?? GUTTER) + 4);
		context.beginPath();
		context.moveTo(coords[0]?.x ?? GUTTER, y(0));
		let previous = coords[0]?.y ?? y(0);
		for (const point of coords) {
			context.lineTo(point.x, previous);
			context.lineTo(point.x, point.y);
			previous = point.y;
		}
		context.lineTo(right, previous);
		context.lineTo(right, y(0));
		context.closePath();
		context.fillStyle = palette.series["series-1"];
		context.globalAlpha = 0.18;
		context.fill();
		context.globalAlpha = 1;
		context.beginPath();
		previous = coords[0]?.y ?? y(0);
		coords.forEach((point, at) => {
			if (at === 0) context.moveTo(point.x, point.y);
			else {
				context.lineTo(point.x, previous);
				context.lineTo(point.x, point.y);
			}
			previous = point.y;
		});
		context.lineTo(right, previous);
		context.strokeStyle = palette.series["series-1"];
		context.stroke();
		context.fillStyle = palette.error;
		for (const point of coords) {
			if (!point.miss) continue;
			context.beginPath();
			context.moveTo(point.x - 3, lane.y + 2);
			context.lineTo(point.x + 3, lane.y + 2);
			context.lineTo(point.x, lane.y + 7);
			context.closePath();
			context.fill();
		}
		const right0 = GUTTER + plotWidth(this.size.width);
		const runs = windowRuns(coords, GUTTER, right0);
		let labelY = lane.y + 9;
		for (const limit of state.timeline.limits) {
			if (limit.value > max) {
				const label = text.limit(limit);
				const w = context.measureText(label).width;
				context.fillStyle = limit.origin === "host" ? palette.muted : palette.warning;
				context.fillText(`${label} ↑`, right0 - w - 14, labelY);
				labelY += 12;
				continue;
			}
			const own = runs.filter((run) => run.model === limit.model);
			const end = own.at(-1);
			if (!end) continue;
			const ly = Math.round(y(limit.value)) + 0.5;
			context.strokeStyle = limit.origin === "host" ? palette.error : palette.warning;
			context.setLineDash([4, 3]);
			context.beginPath();
			for (const run of own) {
				context.moveTo(run.x0, ly);
				context.lineTo(run.x1, ly);
			}
			context.stroke();
			context.setLineDash([]);
			const label = text.limit(limit);
			const w = context.measureText(label).width;
			context.fillStyle = limit.origin === "host" ? palette.error : palette.warning;
			context.fillText(label, Math.max(GUTTER + 2, end.x1 - w - 4), Math.max(labelY, ly - 6));
			labelY += 12;
		}
		const label = text.peak(peak);
		const w = context.measureText(label).width;
		context.fillStyle = palette.canvas;
		context.globalAlpha = 0.8;
		context.fillRect(GUTTER + 2, lane.y + lane.height - 15, w + 8, 13);
		context.globalAlpha = 1;
		context.fillStyle = palette.muted;
		context.fillText(label, GUTTER + 6, lane.y + lane.height - 8);
	}

	private drawSpend(
		context: CanvasRenderingContext2D,
		state: TimelineState,
		palette: Palette,
		text: TimelineText,
		lane: Lane,
	): void {
		const { timeline } = state;
		const pick = (point: SpendPoint) =>
			timeline.headline === "tokens" ? point.tokens : point.cost;
		const series = [timeline.spend, timeline.withSubagents ?? []];
		let max = 0;
		for (const points of series) for (const point of points) max = Math.max(max, pick(point));
		if (max <= 0) max = 1;
		const y = (value: number) => lane.y + lane.height - 4 - (value / max) * (lane.height - 18);
		const line = (points: readonly SpendPoint[], color: string, dash: number[]) => {
			if (points.length === 0) return;
			context.beginPath();
			context.moveTo(GUTTER, y(0));
			let previous = y(0);
			for (const point of points) {
				const x = this.x(point.t);
				context.lineTo(Math.max(GUTTER, x), previous);
				context.lineTo(Math.max(GUTTER, x), y(pick(point)));
				previous = y(pick(point));
			}
			context.lineTo(this.size.width, previous);
			context.strokeStyle = color;
			context.lineWidth = 1.25;
			context.setLineDash(dash);
			context.stroke();
			context.setLineDash([]);
			context.lineWidth = 1;
		};
		if (timeline.withSubagents) line(timeline.withSubagents, palette.series["series-6"], [3, 2]);
		line(timeline.spend, palette.success, []);
		const label = text.spend();
		const w = context.measureText(label).width;
		context.fillStyle = palette.canvas;
		context.globalAlpha = 0.85;
		context.fillRect(GUTTER + 2, lane.y + 1, w + 8, 13);
		context.globalAlpha = 1;
		context.fillStyle = palette.subtle;
		context.fillText(label, GUTTER + 6, lane.y + 8);
	}

	private itemRect(
		state: TimelineState,
		item: TimelineItem,
	): { x0: number; x1: number; y: number; h: number } | null {
		const lane = state.layout.lanes.find((candidate) => candidate.key === item.lane);
		if (!lane) return null;
		const x0 = this.x(item.t0);
		const x1 = item.point ? x0 + 8 : Math.max(x0 + 2, this.x(item.t1));
		if (item.lane === "tools" || item.lane === "subagents")
			return { x0, x1, y: lane.y + 3 + item.track * lane.trackHeight, h: lane.trackHeight - 3 };
		return { x0, x1, y: lane.y + 3, h: lane.height - 6 };
	}

	private drawOverlay(): void {
		const { state, palette, text } = this;
		const context = sizeCanvas(this.overlay, this.size);
		if (!context || !state || !palette || !text) return;
		const { width, height } = this.size;
		context.clearRect(0, 0, width, height);
		const outline = (item: TimelineItem | null | undefined, strong: boolean) => {
			if (!item) return;
			const rect = this.itemRect(state, item);
			if (!rect) return;
			context.strokeStyle = strong ? palette.focus : palette.muted;
			context.lineWidth = strong ? 2 : 1.25;
			context.strokeRect(rect.x0 - 2, rect.y - 2, rect.x1 - rect.x0 + 4, rect.h + 4);
			context.lineWidth = 1;
		};
		outline(state.items.byIndex.get(state.selected), true);
		const hover = this.hover;
		if (!hover) return;
		if (hover.x >= GUTTER) {
			context.fillStyle = palette.muted;
			context.globalAlpha = 0.45;
			context.fillRect(Math.round(hover.x), 0, 1, height);
			context.globalAlpha = 1;
		}
		if (hover.hit?.kind === "item") outline(hover.hit.item, false);
		const lines = hover.hit ? text.tooltip(hover.hit) : [];
		if (lines.length === 0) return;
		context.font = text.font;
		context.textBaseline = "middle";
		const lineHeight = 15;
		const boxWidth = Math.min(
			360,
			Math.max(...lines.map((line) => context.measureText(line).width)) + 14,
		);
		const boxHeight = lines.length * lineHeight + 8;
		const left = Math.min(width - boxWidth - 4, Math.max(4, hover.x + 12));
		const top =
			hover.y + 14 + boxHeight > height ? Math.max(2, hover.y - boxHeight - 8) : hover.y + 14;
		context.fillStyle = palette.canvas;
		context.globalAlpha = 0.96;
		context.fillRect(left, top, boxWidth, boxHeight);
		context.globalAlpha = 1;
		context.strokeStyle = palette.rule;
		context.strokeRect(left + 0.5, top + 0.5, boxWidth - 1, boxHeight - 1);
		lines.forEach((line, at) => {
			context.fillStyle = at === 0 ? palette.text : palette.muted;
			clipText(context, line, left + 7, top + 4 + lineHeight * at + lineHeight / 2, boxWidth - 12);
		});
	}

	private overviewImage(width: number, height: number): HTMLCanvasElement | null {
		const { state, palette } = this;
		if (!state || !palette) return null;
		const key = `${width}:${height}:${this.size.ratio}:${state.model.size}:${state.scale.min}:${state.scale.max}:${state.scale.breaks.length}:${state.mode}`;
		if (this.overview && this.overviewKey === key) return this.overview;
		const image = this.overview ?? document.createElement("canvas");
		const context = sizeCanvas(image, { width, height, ratio: this.size.ratio });
		if (!context) return null;
		context.clearRect(0, 0, width, height);
		const { scale } = state;
		const span = scale.max - scale.min || 1;
		const xOf = (time: number) =>
			GUTTER + ((scale.toUnit(time) - scale.min) / span) * plotWidth(width);
		for (const band of state.timeline.bands) {
			const series = WAIT_SERIES[band.actor];
			if (!series) continue;
			context.fillStyle = palette.series[series];
			const x0 = xOf(band.t0);
			context.fillRect(x0, 2, Math.max(0.6, xOf(band.t1) - x0), 4);
		}
		const tools: PixelSpan[] = [];
		const calls: PixelSpan[] = [];
		const subagents: PixelSpan[] = [];
		for (const event of state.model.events) {
			const x0 = xOf(event.t0);
			const x1 = Math.max(x0 + 1, xOf(event.t1));
			if (event.kind === "tool")
				tools.push({ x0, x1, series: FAMILY_SERIES[event.family], error: isFailure(event) });
			else if (event.kind === "llm")
				calls.push({ x0, x1, series: LLM_SERIES, error: isFailure(event) });
			else if (event.kind === "subagent")
				subagents.push({ x0, x1, series: FAMILY_SERIES.subagent, error: event.error === true });
		}
		for (const run of mergePixels(calls, width)) {
			context.fillStyle = run.error ? palette.error : palette.series[run.series];
			context.fillRect(run.x, 8, run.width, 4);
		}
		for (const run of mergePixels(tools, width)) {
			context.fillStyle = run.error ? palette.error : palette.series[run.series];
			context.fillRect(run.x, 13, run.width, 8);
		}
		for (const run of mergePixels(subagents, width)) {
			context.fillStyle = run.error ? palette.error : palette.series[run.series];
			context.fillRect(run.x, 22, run.width, 3);
		}
		this.overview = image;
		this.overviewKey = key;
		return image;
	}

	private drawHeader(): void {
		const { state, palette, text } = this;
		const context = sizeCanvas(this.header, { ...this.size, height: HEADER_HEIGHT });
		if (!context || !state || !palette || !text) return;
		const { width } = this.size;
		context.clearRect(0, 0, width, HEADER_HEIGHT);
		context.font = text.font;
		context.textBaseline = "middle";
		const image = this.overviewImage(width, OVERVIEW_HEIGHT);
		if (image) context.drawImage(image, 0, 0, width, OVERVIEW_HEIGHT);
		const { scale, view } = state;
		const plot = plotWidth(width);
		const span = scale.max - scale.min || 1;
		const brush0 = Math.max(GUTTER, GUTTER + ((view.u0 - scale.min) / span) * plot);
		const brush1 = Math.min(GUTTER + plot, GUTTER + ((view.u1 - scale.min) / span) * plot);
		context.fillStyle = palette.canvas;
		context.globalAlpha = 0.55;
		context.fillRect(GUTTER, 0, brush0 - GUTTER, OVERVIEW_HEIGHT);
		context.fillRect(brush1, 0, GUTTER + plot - brush1, OVERVIEW_HEIGHT);
		context.globalAlpha = 1;
		context.strokeStyle = palette.focus;
		context.strokeRect(
			Math.round(brush0) + 0.5,
			0.5,
			Math.max(2, Math.round(brush1 - brush0) - 1),
			OVERVIEW_HEIGHT - 2,
		);
		context.fillStyle = palette.focus;
		context.fillRect(Math.round(brush0) - 1, 8, 3, OVERVIEW_HEIGHT - 16);
		context.fillRect(Math.round(brush1) - 2, 8, 3, OVERVIEW_HEIGHT - 16);
		context.fillStyle = palette.rule;
		context.fillRect(0, OVERVIEW_HEIGHT - 1, width, 1);
		const top = OVERVIEW_HEIGHT;
		const middle = top + AXIS_HEIGHT / 2 - 1;
		const blocked: [number, number][] = [];
		for (const gap of scale.breaks) {
			const x0 = plotX(view, width, gap.u0);
			const x1 = plotX(view, width, gap.u1);
			if (x1 < GUTTER || x0 > width) continue;
			blocked.push([x0, x1]);
			context.fillStyle = palette.grid;
			context.fillRect(x0, top, x1 - x0, AXIS_HEIGHT);
			const centre = (x0 + x1) / 2;
			context.strokeStyle = palette.subtle;
			context.beginPath();
			context.moveTo(centre - 4, top + AXIS_HEIGHT - 2);
			context.lineTo(centre - 1, top + AXIS_HEIGHT - 8);
			context.moveTo(centre + 1, top + AXIS_HEIGHT - 2);
			context.lineTo(centre + 4, top + AXIS_HEIGHT - 8);
			context.stroke();
			const label = text.breakLabel(gap.t0, gap.t1);
			const w = context.measureText(label).width;
			if (x1 - x0 > w + 6) {
				context.fillStyle = gap.cause === "user" ? palette.series.primary : palette.muted;
				context.fillText(label, centre - w / 2, middle);
			}
		}
		const tickLabel = (x: number, label: string, color: string) => {
			context.fillStyle = palette.rule;
			context.fillRect(Math.round(x), top + AXIS_HEIGHT - 5, 1, 5);
			const w = context.measureText(label).width;
			if (blocked.some(([x0, x1]) => x + 3 < x1 && x + 3 + w > x0)) return;
			context.fillStyle = color;
			context.fillText(label, x + 3, middle);
		};
		if (state.mode === "steps")
			for (const tick of stepTicks(view, plot)) {
				const x = GUTTER + tick.x;
				if (x >= GUTTER && x <= width) tickLabel(x, text.step(tick.step), palette.subtle);
			}
		else
			for (const tick of this.ticks(scale, view, plot, localOffset(scale.toTime(view.u0)))) {
				const x = GUTTER + tick.x;
				if (x < GUTTER || x > width) continue;
				tickLabel(
					x,
					tick.day
						? `${text.date(tick.time)} ${text.time(tick.time, tick.seconds)}`
						: text.time(tick.time, tick.seconds),
					tick.day ? palette.muted : palette.subtle,
				);
			}
		context.fillStyle = palette.grid;
		context.globalAlpha = 0.35;
		context.fillRect(0, 0, GUTTER - 1, HEADER_HEIGHT);
		context.globalAlpha = 1;
		context.fillStyle = palette.rule;
		context.fillRect(GUTTER - 1, 0, 1, HEADER_HEIGHT);
		const hover = this.hover;
		if (hover && hover.x >= GUTTER) {
			context.fillStyle = palette.muted;
			context.fillRect(Math.round(hover.x), top, 1, AXIS_HEIGHT);
			const t = scale.toTime(view.u0 + ((hover.x - GUTTER) / plot) * (view.u1 - view.u0));
			const label = text.time(t, true);
			const w = context.measureText(label).width + 8;
			const left = Math.min(width - w - 2, Math.max(GUTTER, hover.x - w / 2));
			context.fillStyle = palette.canvas;
			context.fillRect(left, top + 2, w, AXIS_HEIGHT - 6);
			context.strokeStyle = palette.rule;
			context.strokeRect(left + 0.5, top + 2.5, w - 1, AXIS_HEIGHT - 7);
			context.fillStyle = palette.text;
			context.fillText(label, left + 4, middle);
		}
	}
}
