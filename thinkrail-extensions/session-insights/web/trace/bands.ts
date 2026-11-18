import type {
	Interval,
	PlanStep,
	SessionAnalysis,
	SkillActivation,
} from "@thinkrail/pi-session-insights/core";
import type { Palette } from "./palette";

/** A plan step or a skill activation picked on a band: its rows are highlighted in the trace. */
export type BandPick = { kind: "step"; id: string } | { kind: "skill"; index: number };

export function samePick(a: BandPick | null, b: BandPick | null): boolean {
	if (!a || !b) return a === b;
	return a.kind === "step"
		? b.kind === "step" && a.id === b.id
		: b.kind === "skill" && a.index === b.index;
}

/** The stretches a pick covers: a step's in-progress spans, a skill's heuristic scope. */
export function pickIntervals(analysis: SessionAnalysis | null, pick: BandPick): Interval[] {
	if (!analysis) return [];
	if (pick.kind === "skill") {
		const skill = analysis.skills[pick.index];
		return skill ? [{ t0: skill.t, t1: skill.scopeEnd }] : [];
	}
	const step = analysis.plan?.steps.find((candidate) => candidate.id === pick.id);
	return step ? [...step.active] : [];
}

/** The plan's steps, one band row each. */
export function bandSteps(analysis: SessionAnalysis | null): readonly PlanStep[] {
	return analysis?.plan?.steps ?? [];
}

/** Diagonal hatching inside a rectangle: the look of a heuristic span. */
export function hatch(
	context: CanvasRenderingContext2D,
	x0: number,
	y: number,
	width: number,
	height: number,
	color: string,
): void {
	if (width <= 0) return;
	context.save();
	context.beginPath();
	context.rect(x0, y, width, height);
	context.clip();
	context.strokeStyle = color;
	context.globalAlpha = 0.55;
	context.beginPath();
	for (let x = x0 - height; x < x0 + width; x += 5) {
		context.moveTo(x, y + height);
		context.lineTo(x + height, y);
	}
	context.stroke();
	context.restore();
}

export function diamond(context: CanvasRenderingContext2D, x: number, y: number, r: number): void {
	context.beginPath();
	context.moveTo(x, y - r);
	context.lineTo(x + r, y);
	context.lineTo(x, y + r);
	context.lineTo(x - r, y);
	context.closePath();
	context.fill();
}

export function check(context: CanvasRenderingContext2D, x: number, y: number): void {
	context.beginPath();
	context.moveTo(x - 3, y);
	context.lineTo(x - 1, y + 2.5);
	context.lineTo(x + 3.5, y - 3);
	context.stroke();
}

/** One row of plan steps: each step's in-progress spans as bars with its number, done as a check. */
export function drawPlanRow(
	context: CanvasRenderingContext2D,
	steps: readonly PlanStep[],
	xOf: (t: number) => number,
	top: number,
	height: number,
	width: number,
	palette: Palette,
	picked: string | null,
): void {
	const bar = Math.max(6, height - 8);
	const y = top + (height - bar) / 2;
	steps.forEach((step, at) => {
		for (const span of step.active) {
			const x0 = xOf(span.t0);
			const x1 = Math.max(x0 + 2, xOf(span.t1));
			if (x1 < 0 || x0 > width) continue;
			context.fillStyle = palette.series["series-7"];
			context.globalAlpha = at % 2 === 0 ? 0.85 : 0.55;
			context.fillRect(x0, y, x1 - x0, bar);
			context.globalAlpha = 1;
			if (step.errors.value) {
				context.fillStyle = palette.error;
				context.fillRect(x0, y + bar - 2, x1 - x0, 2);
			}
			const label = String(at + 1);
			if (x1 - x0 > context.measureText(label).width + 6) {
				context.fillStyle = palette.canvas;
				context.fillText(label, x0 + 3, y + bar / 2 + 0.5);
			}
			if (picked === step.id) {
				context.strokeStyle = palette.focus;
				context.lineWidth = 1.5;
				context.strokeRect(x0 - 1.5, y - 1.5, x1 - x0 + 3, bar + 3);
				context.lineWidth = 1;
			}
		}
		const done = step.changes.find((change) => change.status === "done");
		if (done) {
			const x = xOf(done.t);
			if (x >= 0 && x <= width) {
				context.strokeStyle = palette.success;
				check(context, x, top + height / 2);
			}
		}
	});
}

/** The skills row: an activation diamond, its hatched heuristic scope and the skill's name. */
export function drawSkillRow(
	context: CanvasRenderingContext2D,
	skills: readonly SkillActivation[],
	xOf: (t: number) => number,
	top: number,
	height: number,
	width: number,
	palette: Palette,
	picked: number | null,
): void {
	const middle = top + height / 2;
	skills.forEach((skill, at) => {
		const x0 = xOf(skill.t);
		const x1 = Math.max(x0, xOf(skill.scopeEnd));
		if (x1 < 0 || x0 > width) return;
		const color = skill.workflow ? palette.series["series-5"] : palette.series["series-1"];
		hatch(context, x0, top + 4, x1 - x0, height - 8, color);
		context.fillStyle = color;
		diamond(context, x0, middle, 4);
		const room = (skills[at + 1] ? xOf(skills[at + 1]?.t ?? 0) : width) - x0 - 10;
		if (room > 24) {
			context.fillStyle = palette.text;
			const label = fitText(context, skill.name, room);
			if (label) context.fillText(label, x0 + 7, middle + 0.5);
		}
		if (picked === at) {
			context.strokeStyle = palette.focus;
			context.lineWidth = 1.5;
			context.strokeRect(x0 - 5.5, top + 2.5, Math.max(11, x1 - x0 + 7), height - 5);
			context.lineWidth = 1;
		}
	});
}

function fitText(context: CanvasRenderingContext2D, text: string, max: number): string {
	if (context.measureText(text).width <= max) return text;
	let lo = 0;
	let hi = text.length;
	while (lo < hi) {
		const mid = (lo + hi + 1) >> 1;
		if (context.measureText(`${text.slice(0, mid)}…`).width <= max) lo = mid;
		else hi = mid - 1;
	}
	return lo > 0 ? `${text.slice(0, lo)}…` : "";
}

/** The step whose in-progress span is under `x` (a few pixels of slack), else the nearest done check. */
export function hitPlanRow(
	steps: readonly PlanStep[],
	xOf: (t: number) => number,
	x: number,
	slack = 3,
): PlanStep | null {
	for (const step of steps)
		for (const span of step.active) {
			const x0 = xOf(span.t0);
			const x1 = Math.max(x0 + 2, xOf(span.t1));
			if (x >= x0 - slack && x <= x1 + slack) return step;
		}
	return null;
}

export function hitSkillRow(
	skills: readonly SkillActivation[],
	xOf: (t: number) => number,
	x: number,
	slack = 5,
): number | null {
	let found: number | null = null;
	skills.forEach((skill, at) => {
		const x0 = xOf(skill.t);
		const x1 = Math.max(x0, xOf(skill.scopeEnd));
		if (x >= x0 - slack && x <= x1) found = at;
	});
	return found;
}
