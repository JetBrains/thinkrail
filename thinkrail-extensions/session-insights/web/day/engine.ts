import type { DayTimelineResult } from "@thinkrail/pi-session-insights/core";
import { FAMILY_SERIES } from "../trace/model";
import type { Palette } from "../trace/palette";
import type { AxisScale } from "../trace/scale";
import { DAY_HEADER_PX, type DayHit, dayX, ROW_PX, WARM_ROW_PX } from "./layout";

const MIN_HOUR_LABEL_PX = 44;

export interface DayText {
	font: string;
	hour: (hour: number) => string;
	empty: (ms: number) => string;
	continues: string;
	tooltip: (hit: DayHit) => string[];
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

/**
 * The day strip's canvases: the hour axis, the body (warm caches at once, then one row per session) and
 * an overlay for the hover rule and tooltip. Drawing is coalesced into one animation frame.
 */
export class DayEngine {
	private readonly header: HTMLCanvasElement;
	private readonly body: HTMLCanvasElement;
	private readonly overlay: HTMLCanvasElement;
	private day: DayTimelineResult | null = null;
	private scale: AxisScale | null = null;
	private palette: Palette | null = null;
	private text: DayText | null = null;
	private width = 0;
	private height = 0;
	private ratio = 1;
	private hover: { x: number; y: number; hit: DayHit | null } | null = null;
	private request = 0;
	private pending = { header: false, body: false, overlay: false };

	constructor(header: HTMLCanvasElement, body: HTMLCanvasElement, overlay: HTMLCanvasElement) {
		this.header = header;
		this.body = body;
		this.overlay = overlay;
	}

	dispose(): void {
		if (this.request) cancelAnimationFrame(this.request);
		this.request = 0;
		this.day = null;
	}

	setDay(day: DayTimelineResult, scale: AxisScale | null): void {
		this.day = day;
		this.scale = scale;
		this.schedule(true, true, true);
	}

	setLook(palette: Palette, text: DayText): void {
		this.palette = palette;
		this.text = text;
		this.schedule(true, true, true);
	}

	setSize(width: number, height: number, ratio: number): void {
		this.width = width;
		this.height = height;
		this.ratio = ratio;
		this.schedule(true, true, true);
	}

	setHover(hover: { x: number; y: number; hit: DayHit | null } | null): void {
		this.hover = hover;
		this.schedule(false, false, true);
	}

	private schedule(header: boolean, body: boolean, overlay: boolean): void {
		this.pending.header ||= header;
		this.pending.body ||= body;
		this.pending.overlay ||= overlay;
		if (this.request) return;
		this.request = requestAnimationFrame(() => {
			this.request = 0;
			const due = this.pending;
			this.pending = { header: false, body: false, overlay: false };
			if (due.header) this.drawHeader();
			if (due.body) this.drawBody();
			if (due.overlay) this.drawOverlay();
		});
	}

	private x(time: number): number {
		return this.scale ? dayX(this.scale, this.width, time) : 0;
	}

	private drawHeader(): void {
		const { day, scale, palette, text } = this;
		const context = sizeCanvas(this.header, {
			width: this.width,
			height: DAY_HEADER_PX,
			ratio: this.ratio,
		});
		if (!context || !day || !scale || !palette || !text) return;
		context.clearRect(0, 0, this.width, DAY_HEADER_PX);
		context.font = text.font;
		context.textBaseline = "middle";
		for (const gap of scale.breaks) {
			const x0 = this.x(gap.t0);
			const x1 = this.x(gap.t1);
			context.fillStyle = palette.grid;
			context.fillRect(x0, 0, x1 - x0, DAY_HEADER_PX);
		}
		let last = Number.NEGATIVE_INFINITY;
		for (const hour of day.hours) {
			if (scale.breaks.some((gap) => hour.t >= gap.t0 && hour.t < gap.t1)) continue;
			const x = this.x(hour.t);
			if (x - last < MIN_HOUR_LABEL_PX || x > this.width - 20) continue;
			context.fillStyle = palette.rule;
			context.fillRect(Math.round(x), DAY_HEADER_PX - 5, 1, 5);
			context.fillStyle = palette.subtle;
			context.fillText(text.hour(hour.hour), x + 3, DAY_HEADER_PX / 2);
			last = x;
		}
	}

	private drawBody(): void {
		const { day, scale, palette, text } = this;
		const context = sizeCanvas(this.body, {
			width: this.width,
			height: this.height,
			ratio: this.ratio,
		});
		if (!context || !day || !scale || !palette || !text) return;
		const { width, height } = this;
		context.clearRect(0, 0, width, height);
		context.font = text.font;
		context.textBaseline = "middle";
		context.fillStyle = palette.grid;
		context.globalAlpha = 0.5;
		for (const hour of day.hours) context.fillRect(Math.round(this.x(hour.t)), 0, 1, height);
		context.globalAlpha = 1;
		for (const gap of scale.breaks) {
			const x0 = this.x(gap.t0);
			const x1 = this.x(gap.t1);
			context.fillStyle = palette.grid;
			context.globalAlpha = 0.45;
			context.fillRect(x0, 0, x1 - x0, height);
			context.globalAlpha = 1;
			if (x1 - x0 > 10) {
				context.save();
				context.translate((x0 + x1) / 2 + 3, Math.min(height - 6, WARM_ROW_PX + 70));
				context.rotate(-Math.PI / 2);
				context.fillStyle = palette.subtle;
				context.fillText(text.empty(gap.t1 - gap.t0), 0, 0);
				context.restore();
			}
		}
		let peak = 1;
		for (const point of day.warmCount) peak = Math.max(peak, point.count);
		context.beginPath();
		context.moveTo(0, WARM_ROW_PX - 3);
		let previous = WARM_ROW_PX - 3;
		for (const point of day.warmCount) {
			const x = this.x(point.t);
			const y = WARM_ROW_PX - 3 - (point.count / peak) * (WARM_ROW_PX - 8);
			context.lineTo(x, previous);
			context.lineTo(x, y);
			previous = y;
		}
		context.lineTo(width, previous);
		context.lineTo(width, WARM_ROW_PX - 3);
		context.closePath();
		context.fillStyle = palette.success;
		context.globalAlpha = 0.35;
		context.fill();
		context.globalAlpha = 1;
		context.fillStyle = palette.rule;
		context.fillRect(0, WARM_ROW_PX - 0.5, width, 1);
		day.sessions.forEach((session, row) => {
			const top = WARM_ROW_PX + row * ROW_PX;
			context.fillStyle = palette.grid;
			context.fillRect(0, top + ROW_PX - 0.5, width, 1);
			context.fillStyle = palette.success;
			context.globalAlpha = 0.55;
			for (const warm of session.warm) {
				const x0 = this.x(warm.t0);
				context.fillRect(x0, top + ROW_PX - 9, Math.max(1, this.x(warm.t1) - x0), 3);
			}
			context.globalAlpha = 1;
			for (const turn of session.turns) {
				const x0 = this.x(turn.t0);
				const x1 = Math.max(x0 + 2, this.x(turn.t1));
				context.fillStyle = palette.series.primary;
				context.globalAlpha = 0.08;
				context.fillRect(x0, top + 6, x1 - x0, 16);
				context.globalAlpha = 1;
				context.strokeStyle = turn.trigger === "prompt" ? palette.series.primary : palette.muted;
				context.strokeRect(x0 + 0.5, top + 6.5, x1 - x0 - 1, 15);
			}
			context.fillStyle = palette.series.primary;
			context.globalAlpha = 0.3;
			for (const wait of session.userWaits) {
				const x0 = this.x(wait.t0);
				context.fillRect(x0, top + 7, Math.max(1, this.x(wait.t1) - x0), 14);
			}
			context.globalAlpha = 1;
			let most = 1;
			for (const tick of session.ticks) most = Math.max(most, tick.n);
			for (const tick of session.ticks) {
				const x = this.x(tick.t);
				const tall = 4 + 10 * Math.sqrt(tick.n / most);
				context.fillStyle = palette.series[FAMILY_SERIES[tick.family]];
				context.fillRect(x, top + 21 - tall, Math.max(1.5, this.x(tick.t + 60_000) - x), tall);
				if (tick.errors > 0) {
					context.fillStyle = palette.error;
					context.fillRect(x, top + 4, Math.max(1.5, this.x(tick.t + 60_000) - x), 3);
				}
			}
			context.fillStyle = palette.series["series-1"];
			for (const miss of session.misses) {
				const x = this.x(miss);
				context.beginPath();
				context.moveTo(x - 3, top + ROW_PX - 2);
				context.lineTo(x + 3, top + ROW_PX - 2);
				context.lineTo(x, top + ROW_PX - 7);
				context.closePath();
				context.fill();
			}
			if (session.continues) {
				const label = text.continues;
				const w = context.measureText(label).width;
				context.fillStyle = palette.canvas;
				context.globalAlpha = 0.85;
				context.fillRect(width - w - 10, top + 6, w + 8, 16);
				context.globalAlpha = 1;
				context.fillStyle = palette.muted;
				context.fillText(label, width - w - 6, top + 14);
			}
		});
	}

	private drawOverlay(): void {
		const { palette, text } = this;
		const context = sizeCanvas(this.overlay, {
			width: this.width,
			height: this.height,
			ratio: this.ratio,
		});
		if (!context || !palette || !text) return;
		const { width, height } = this;
		context.clearRect(0, 0, width, height);
		const hover = this.hover;
		if (!hover) return;
		context.fillStyle = palette.muted;
		context.globalAlpha = 0.45;
		context.fillRect(Math.round(hover.x), 0, 1, height);
		context.globalAlpha = 1;
		if (hover.hit?.kind === "row") {
			context.fillStyle = palette.selected;
			context.globalAlpha = 0.35;
			context.fillRect(0, WARM_ROW_PX + hover.hit.row * ROW_PX, width, ROW_PX);
			context.globalAlpha = 1;
		}
		const lines = hover.hit ? text.tooltip(hover.hit) : [];
		if (lines.length === 0) return;
		context.font = text.font;
		context.textBaseline = "middle";
		const lineHeight = 15;
		const boxWidth = Math.min(
			340,
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
			context.fillText(line, left + 7, top + 4 + lineHeight * at + lineHeight / 2);
		});
	}
}
