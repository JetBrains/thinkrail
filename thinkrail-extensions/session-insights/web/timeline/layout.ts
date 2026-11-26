import type {
	ContextPoint,
	SessionAnalysis,
	SessionTimeline,
	WaitActor,
	WaitBand,
} from "@thinkrail/pi-session-insights/core";
import { hitSkillRow } from "../trace/bands";
import type { SeriesKey, TraceModel } from "../trace/model";
import type { AxisBreak, AxisScale, View } from "../trace/scale";

/** The lane labels' column on the canvas' left. */
export const GUTTER = 112;
const RIGHT_PAD = 8;
export const TOOL_TRACK_PX = 14;
export const SUBAGENT_TRACK_PX = 12;
const HIT_SLACK_PX = 4;
const PROMPT_SLACK_PX = 6;

export type LaneKey =
	| "band"
	| "user"
	| "model"
	| "tools"
	| "subagents"
	| "context"
	| "spend"
	| "skills"
	| "plan";

export interface Lane {
	key: LaneKey;
	y: number;
	height: number;
	tracks: number;
	trackHeight: number;
	/** A plan lane's step, by its index in the plan. */
	step: number;
}

export const PLAN_LANE_PX = 14;
export const SKILL_LANE_PX = 20;

export interface LaneLayout {
	lanes: readonly Lane[];
	height: number;
}

export const WAIT_SERIES = {
	user: "primary",
	model: "series-3",
	tool: "series-4",
	subagent: "series-6",
	background: "series-2",
	idle: null,
} as const satisfies Record<WaitActor, SeriesKey | null>;

/**
 * Lanes top to bottom: who blocks, you, the model, packed tools, packed subagents, context, spend, then
 * the skills row and one row per plan step when shown.
 */
export function layoutLanes(
	toolTracks: number,
	subagentTracks: number,
	plan: { steps: number; skills: boolean } = { steps: 0, skills: false },
): LaneLayout {
	const lanes: Lane[] = [];
	let y = 4;
	const add = (
		key: LaneKey,
		height: number,
		tracks = 1,
		trackHeight = height,
		gapAfter = 0,
		step = -1,
	) => {
		lanes.push({ key, y, height, tracks, trackHeight, step });
		y += height + gapAfter;
	};
	add("band", 16, 1, 16, 4);
	add("user", 26);
	add("model", 26);
	const tools = Math.max(1, toolTracks);
	add("tools", tools * TOOL_TRACK_PX + 6, tools, TOOL_TRACK_PX);
	const subagents = Math.max(0, subagentTracks);
	add(
		"subagents",
		subagents > 0 ? subagents * SUBAGENT_TRACK_PX + 6 : 22,
		subagents,
		SUBAGENT_TRACK_PX,
		4,
	);
	add("context", 56);
	add("spend", 40, 1, 40, plan.skills || plan.steps > 0 ? 6 : 0);
	if (plan.skills) add("skills", SKILL_LANE_PX);
	for (let step = 0; step < plan.steps; step++) add("plan", PLAN_LANE_PX, 1, PLAN_LANE_PX, 0, step);
	return { lanes, height: y + 4 };
}

export function plotWidth(width: number): number {
	return Math.max(1, width - GUTTER - RIGHT_PAD);
}

/** Canvas x of an axis unit (the plot starts after the gutter). */
export function plotX(view: View, width: number, unit: number): number {
	return GUTTER + ((unit - view.u0) / (view.u1 - view.u0 || 1)) * plotWidth(width);
}

export function plotUnit(view: View, width: number, x: number): number {
	return view.u0 + ((x - GUTTER) / plotWidth(width)) * (view.u1 - view.u0);
}

export type ItemLane = "user" | "model" | "tools" | "subagents";

export interface TimelineItem {
	/** The event's index in the trace model. */
	index: number;
	lane: ItemLane;
	track: number;
	t0: number;
	t1: number;
	/** A moment (a turn's start), drawn as a flag. */
	point: boolean;
}

/** The lane items of a trace, per lane and track in time order, plus the keyboard's time order. */
export class TimelineItems {
	readonly tracks = new Map<string, TimelineItem[]>();
	readonly byIndex = new Map<number, TimelineItem>();
	/** Selectable event indices by start time, then trace order. */
	readonly ordered: readonly number[];

	constructor(model: TraceModel, timeline: SessionTimeline) {
		const trackOf = new Map(timeline.lanes.tracks.map((item) => [item.id, item.track]));
		const all: TimelineItem[] = [];
		model.events.forEach((event, index) => {
			let lane: ItemLane | null = null;
			let point = false;
			if (event.kind === "turn") {
				lane = "user";
				point = true;
			} else if (event.kind === "llm") lane = "model";
			else if (event.kind === "tool") lane = event.family === "ask" ? "user" : "tools";
			else if (event.kind === "subagent") lane = "subagents";
			if (!lane) return;
			const track = lane === "tools" || lane === "subagents" ? (trackOf.get(event.id) ?? 0) : 0;
			all.push({ index, lane, track, t0: event.t0, t1: point ? event.t0 : event.t1, point });
		});
		for (const item of all) {
			const key = `${item.lane}:${item.track}`;
			const list = this.tracks.get(key) ?? [];
			list.push(item);
			this.tracks.set(key, list);
			this.byIndex.set(item.index, item);
		}
		for (const list of this.tracks.values()) list.sort((a, b) => a.t0 - b.t0 || a.index - b.index);
		this.ordered = [...all]
			.sort((a, b) => a.t0 - b.t0 || a.index - b.index)
			.map((item) => item.index);
	}

	track(lane: ItemLane, track: number): readonly TimelineItem[] {
		return this.tracks.get(`${lane}:${track}`) ?? [];
	}

	/** The next (`1`) or previous (`-1`) item in time from an event, `null` past either end. */
	step(from: number, direction: 1 | -1): number | null {
		const at = this.ordered.indexOf(from);
		if (at < 0) return this.ordered[direction === 1 ? 0 : this.ordered.length - 1] ?? null;
		return this.ordered[at + direction] ?? null;
	}
}

export type TimelineHit =
	| { kind: "item"; item: TimelineItem }
	| { kind: "band"; band: WaitBand }
	| { kind: "pause"; stretch: AxisBreak }
	| { kind: "context"; point: ContextPoint; index: number }
	| { kind: "spend"; t: number }
	| { kind: "lane"; lane: LaneKey; step: number }
	| { kind: "step"; step: number }
	| { kind: "skill"; index: number };

export interface HitInput {
	layout: LaneLayout;
	items: TimelineItems;
	model: TraceModel;
	timeline: SessionTimeline;
	analysis: SessionAnalysis | null;
	scale: AxisScale;
	view: View;
	width: number;
}

function laneAt(layout: LaneLayout, y: number): Lane | null {
	return layout.lanes.find((lane) => y >= lane.y && y < lane.y + lane.height) ?? null;
}

function lastStartingBefore<T>(
	list: readonly T[],
	at: number,
	startOf: (item: T) => number,
): number {
	let lo = 0;
	let hi = list.length - 1;
	let found = -1;
	while (lo <= hi) {
		const mid = (lo + hi) >> 1;
		if (startOf(list[mid] as T) <= at) {
			found = mid;
			lo = mid + 1;
		} else hi = mid - 1;
	}
	return found;
}

/** What is under canvas point `(x, y)`: a lane label, an item, a band, a compressed gap or a counter. */
export function hitTimeline(input: HitInput, x: number, y: number): TimelineHit | null {
	const { layout, items, model, timeline, scale, view, width } = input;
	const lane = laneAt(layout, y);
	if (!lane) return null;
	if (x < GUTTER) return { kind: "lane", lane: lane.key, step: lane.step };
	const unit = plotUnit(view, width, x);
	const time = scale.toTime(unit);
	const pixel = (t: number) => plotX(view, width, scale.toUnit(t));
	const gap = scale.breaks.find((candidate) => unit >= candidate.u0 && unit <= candidate.u1);
	const near = (list: readonly TimelineItem[], slack: number): TimelineItem | null => {
		const slackTime = Math.abs(
			scale.toTime(unit + (slack / plotWidth(width)) * (view.u1 - view.u0)) - time,
		);
		const at = lastStartingBefore(list, time + slackTime, (item) => item.t0);
		let best: TimelineItem | null = null;
		let bestDistance = Number.POSITIVE_INFINITY;
		for (let k = at; k >= 0 && k > at - 12; k--) {
			const item = list[k];
			if (!item) continue;
			const x0 = pixel(item.t0);
			const x1 = item.point ? x0 : Math.max(x0, pixel(item.t1));
			const distance = x < x0 ? x0 - x : x > x1 ? x - x1 : 0;
			if (distance <= slack && distance < bestDistance) {
				best = item;
				bestDistance = distance;
			}
		}
		return best;
	};
	switch (lane.key) {
		case "band": {
			const at = lastStartingBefore(timeline.bands, time, (band) => band.t0);
			const band = timeline.bands[at];
			if (band && time <= band.t1) return { kind: "band", band };
			return gap ? { kind: "pause", stretch: gap } : null;
		}
		case "user":
		case "model":
		case "tools":
		case "subagents": {
			const track =
				lane.tracks <= 1
					? 0
					: Math.min(lane.tracks - 1, Math.max(0, Math.floor((y - lane.y - 3) / lane.trackHeight)));
			const found = near(
				items.track(lane.key, track),
				lane.key === "user" ? PROMPT_SLACK_PX : HIT_SLACK_PX,
			);
			if (found) return { kind: "item", item: found };
			return gap ? { kind: "pause", stretch: gap } : null;
		}
		case "context": {
			const points = timeline.context;
			const at = lastStartingBefore(
				points,
				time,
				(point) => model.at(model.indexOf(point.id))?.t0 ?? 0,
			);
			const point = points[Math.max(0, at)];
			if (!point) return null;
			return { kind: "context", point, index: model.indexOf(point.id) };
		}
		case "spend":
			return { kind: "spend", t: time };
		case "skills": {
			const index = hitSkillRow(input.analysis?.skills ?? [], pixel, x);
			return index === null ? null : { kind: "skill", index };
		}
		case "plan": {
			const step = input.analysis?.plan?.steps[lane.step];
			if (!step) return null;
			const from = pixel(step.first);
			const last = step.changes.at(-1)?.t ?? step.first;
			const to = Math.max(pixel(last), ...step.active.map((span) => pixel(span.t1)));
			return x >= from - HIT_SLACK_PX && x <= to + HIT_SLACK_PX
				? { kind: "step", step: lane.step }
				: null;
		}
	}
}

/** The step function's value at `t`: the last point at or before it. */
export function valueAt<T extends { t: number }>(points: readonly T[], t: number): T | null {
	const at = lastStartingBefore(points, t, (point) => point.t);
	return at >= 0 ? (points[at] ?? null) : null;
}

/** One model's stretch of the Context track, drawn with that model's own window line. */
export interface WindowRun {
	model: string;
	x0: number;
	x1: number;
}

/**
 * The runs of consecutive context points of one model: a run spans from its first point to the next
 * run's first point, the first from `left` and the last to `right`, so a session that switches models
 * draws each window only over its own calls.
 */
export function windowRuns(
	points: readonly { x: number; model: string }[],
	left: number,
	right: number,
): WindowRun[] {
	const runs: WindowRun[] = [];
	for (const point of points) {
		const last = runs.at(-1);
		if (last?.model === point.model) continue;
		if (last) last.x1 = point.x;
		runs.push({ model: point.model, x0: last ? point.x : left, x1: right });
	}
	return runs;
}
