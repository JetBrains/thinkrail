import type { SpawnWave, SubagentActivity, SubagentRun } from "@thinkrail/pi-session-insights/core";
import { FAMILY_SERIES, LLM_SERIES } from "../trace/model";
import type { Palette } from "../trace/palette";
import { roleSeries } from "../trace/roles";

/** Lane geometry shared by the wave canvas and its DOM rows. */
export const WAVE_ROW = 24;
export const WAVE_PAD = 8;

function ticksOn(
	context: CanvasRenderingContext2D,
	activity: SubagentActivity,
	xOf: (t: number) => number,
	llmY: number,
	llmH: number,
	toolY: number,
	toolH: number,
	palette: Palette,
	right: number,
): void {
	for (const [offset, duration, kind, error] of activity.ticks) {
		const x0 = xOf(activity.t0 + offset);
		const x1 = Math.min(right, Math.max(x0 + 1, xOf(activity.t0 + offset + duration)));
		const family = kind < 0 ? null : activity.families[kind];
		context.fillStyle = error
			? palette.error
			: family
				? palette.series[FAMILY_SERIES[family]]
				: palette.series[LLM_SERIES];
		if (kind < 0) context.fillRect(x0, llmY, x1 - x0, llmH);
		else context.fillRect(x0, toolY, x1 - x0, toolH);
	}
}

/** A subagent's own activity on its own clock: model calls on top, tool calls below. */
export function drawActivityStrip(
	context: CanvasRenderingContext2D,
	width: number,
	height: number,
	activity: SubagentActivity,
	palette: Palette,
): void {
	context.clearRect(0, 0, width, height);
	context.fillStyle = palette.grid;
	context.globalAlpha = 0.5;
	context.fillRect(0, 0, width, height);
	context.globalAlpha = 1;
	const span = Math.max(1, activity.t1 - activity.t0);
	const xOf = (t: number) => 4 + ((t - activity.t0) / span) * (width - 8);
	ticksOn(context, activity, xOf, 4, 6, 14, height - 18, palette, width - 4);
}

export interface WaveGeometry {
	width: number;
	t0: number;
	t1: number;
	/** Plot's left edge (after the label column). */
	left: number;
}

/** A wave's rows: one per run, in packing order (lane, then start), so sequential runs sit together. */
export function waveRows(wave: SpawnWave, runs: readonly SubagentRun[]): SubagentRun[] {
	return runs
		.filter((run) => run.wave === wave.n - 1)
		.sort((a, b) => a.lane - b.lane || a.t0 - b.t0 || (a.childId < b.childId ? -1 : 1));
}

/**
 * One spawn wave: the parent's line on top with a ring at each spawn and a dot where it read each
 * result, a fan-out curve to every run, each run's bar with its activity ticks, and a dashed fan-in
 * curve from the run's end to the read.
 */
export function drawWave(
	context: CanvasRenderingContext2D,
	geometry: WaveGeometry,
	height: number,
	rows: readonly SubagentRun[],
	palette: Palette,
	hovered: string | null,
): void {
	const { width, left, t0, t1 } = geometry;
	context.clearRect(0, 0, width, height);
	const right = width - WAVE_PAD;
	const span = Math.max(1, t1 - t0);
	const xOf = (t: number) => left + ((t - t0) / span) * (right - left);
	const parentY = WAVE_ROW / 2;
	context.strokeStyle = palette.rule;
	context.lineWidth = 2;
	context.beginPath();
	context.moveTo(left, parentY);
	context.lineTo(right, parentY);
	context.stroke();
	context.lineWidth = 1;
	const spawns = new Set<number>();
	const reads = new Set<number>();
	rows.forEach((run, row) => {
		const y = WAVE_ROW + row * WAVE_ROW + WAVE_ROW / 2;
		const color = palette.series[roleSeries(run.role)];
		const xs = xOf(run.spawnAt);
		const xa = xOf(run.t0);
		const xb = Math.max(xa + 2, xOf(run.t1));
		spawns.add(Math.round(xs));
		context.strokeStyle = color;
		context.globalAlpha = 0.6;
		context.beginPath();
		context.moveTo(xs, parentY);
		context.bezierCurveTo(xs, y - 4, xa - 6, y, xa, y);
		context.stroke();
		context.globalAlpha = hovered === run.childId ? 0.32 : 0.16;
		context.fillStyle = color;
		context.fillRect(xa, y - 7, xb - xa, 14);
		context.globalAlpha = 1;
		const failed = run.status === "failed" || run.status === "error" || run.status === "aborted";
		context.strokeStyle = failed ? palette.error : color;
		context.lineWidth = failed || hovered === run.childId ? 1.75 : 1;
		context.setLineDash(run.background ? [] : [3, 2]);
		context.strokeRect(xa + 0.5, y - 6.5, Math.max(1, xb - xa - 1), 13);
		context.setLineDash([]);
		context.lineWidth = 1;
		if (run.activity) {
			const scaleT = (t: number) => xOf(t);
			context.save();
			context.beginPath();
			context.rect(xa, y - 7, xb - xa, 14);
			context.clip();
			ticksOn(context, run.activity, scaleT, y - 5, 3, y - 1, 6, palette, xb);
			context.restore();
		}
		if (run.consumedAt !== null) {
			const xc = xOf(run.consumedAt);
			reads.add(Math.round(xc));
			context.strokeStyle = palette.success;
			context.globalAlpha = 0.6;
			context.setLineDash([3, 2]);
			context.beginPath();
			context.moveTo(xb, y);
			context.bezierCurveTo(xb + 8, y, xc, y - 4, xc, parentY);
			context.stroke();
			context.setLineDash([]);
			context.globalAlpha = 1;
		}
	});
	for (const x of spawns) {
		context.fillStyle = palette.canvas;
		context.strokeStyle = palette.series["series-6"];
		context.lineWidth = 1.75;
		context.beginPath();
		context.arc(x, parentY, 4, 0, Math.PI * 2);
		context.fill();
		context.stroke();
		context.lineWidth = 1;
	}
	context.fillStyle = palette.success;
	for (const x of reads) {
		context.beginPath();
		context.arc(x, parentY, 3.5, 0, Math.PI * 2);
		context.fill();
	}
}
