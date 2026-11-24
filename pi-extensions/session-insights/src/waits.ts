import {
	BACKGROUND_COMPLETION_MESSAGE,
	type GapCause,
	SUBAGENT_COMPLETION_MESSAGE,
	TRACE_GAP_MIN_MS,
	type TraceEvent,
	type TraceGap,
	type WaitActor,
	type WaitBand,
} from "./core.ts";

/** An unexplained pause before the agent resumes on its own reads as the agent working up to this long. */
export const AGENT_LATENCY_MAX_MS = 60_000;

const TOOL = 0;
const MODEL = 1;
const SUBAGENT = 2;
const ASK = 3;

interface Trigger {
	t: number;
	actor: WaitActor;
}

function categoryOf(event: TraceEvent): number | null {
	switch (event.kind) {
		case "llm":
			return MODEL;
		case "subagent":
			return SUBAGENT;
		case "tool":
			if (event.family === "ask") return ASK;
			return event.family === "subagent" ? SUBAGENT : TOOL;
		default:
			return null;
	}
}

function triggerOf(event: TraceEvent): WaitActor | null {
	if (event.kind === "turn") return event.trigger === "prompt" ? "user" : "background";
	if (event.kind === "mark" && event.mark === "customMessage")
		return event.detail === BACKGROUND_COMPLETION_MESSAGE ||
			event.detail === SUBAGENT_COMPLETION_MESSAGE
			? "background"
			: null;
	return null;
}

function lowerBound(values: readonly number[], target: number): number {
	let lo = 0;
	let hi = values.length;
	while (lo < hi) {
		const mid = (lo + hi) >> 1;
		if ((values[mid] ?? 0) < target) lo = mid + 1;
		else hi = mid;
	}
	return lo;
}

/**
 * Who the session waits on, moment by moment, as merged bands over `start..end`. Running work wins in
 * the order an open question to the user, a tool, the model, a subagent. A stretch where nothing runs
 * is attributed to what ends it: a prompt (the user), a completion message (background work), the agent
 * resuming on its own within `AGENT_LATENCY_MAX_MS` (the model), else nobody (`idle`).
 */
export function waitBands(events: readonly TraceEvent[], start: number, end: number): WaitBand[] {
	if (!(end > start)) return [];
	const points: [number, number, number][] = [];
	const starts: number[] = [];
	const triggers: Trigger[] = [];
	const cuts = new Set<number>([start, end]);
	for (const event of events) {
		const trigger = triggerOf(event);
		if (trigger && event.t0 >= start && event.t0 <= end) {
			triggers.push({ t: event.t0, actor: trigger });
			cuts.add(event.t0);
		}
		const category = categoryOf(event);
		if (category === null || !(event.t1 > event.t0)) continue;
		const t0 = Math.max(start, event.t0);
		const t1 = Math.min(end, event.t1);
		if (!(t1 > t0)) continue;
		points.push([t0, 1, category], [t1, -1, category]);
		starts.push(t0);
		cuts.add(t0);
		cuts.add(t1);
	}
	points.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
	starts.sort((a, b) => a - b);
	triggers.sort((a, b) => a.t - b.t || (a.actor < b.actor ? -1 : a.actor > b.actor ? 1 : 0));
	const triggerTimes = triggers.map((trigger) => trigger.t);
	const boundaries = [...cuts].sort((a, b) => a - b);
	const counts = [0, 0, 0, 0];
	const bands: WaitBand[] = [];
	let next = 0;
	const idleActor = (a: number, b: number): WaitActor => {
		const trigger = triggers[lowerBound(triggerTimes, b)];
		const resume = starts[lowerBound(starts, b)];
		if (trigger && (resume === undefined || trigger.t <= resume)) return trigger.actor;
		if (resume === undefined) return "idle";
		return b - a <= AGENT_LATENCY_MAX_MS ? "model" : "idle";
	};
	for (let at = 0; at + 1 < boundaries.length; at++) {
		const a = boundaries[at] ?? start;
		const b = boundaries[at + 1] ?? end;
		for (let point = points[next]; point && point[0] <= a; point = points[++next])
			counts[point[2]] = (counts[point[2]] ?? 0) + point[1];
		const actor: WaitActor =
			(counts[ASK] ?? 0) > 0
				? "user"
				: (counts[TOOL] ?? 0) > 0
					? "tool"
					: (counts[MODEL] ?? 0) > 0
						? "model"
						: (counts[SUBAGENT] ?? 0) > 0
							? "subagent"
							: idleActor(a, b);
		const last = bands.at(-1);
		if (last && last.actor === actor && last.t1 === a) last.t1 = b;
		else bands.push({ t0: a, t1: b, actor });
	}
	return bands;
}

const IDLE_LIKE: ReadonlySet<WaitActor> = new Set<WaitActor>(["user", "background", "idle"]);
const CAUSE_ORDER: readonly GapCause[] = ["user", "background", "idle"];

/** Runs of bands where only the user, background work or nobody is waited on, at least `TRACE_GAP_MIN_MS` long; the cause is who took most of it. */
export function idleGaps(bands: readonly WaitBand[]): TraceGap[] {
	const gaps: TraceGap[] = [];
	let run: { t0: number; t1: number; time: Record<GapCause, number> } | null = null;
	const flush = () => {
		if (run && run.t1 - run.t0 >= TRACE_GAP_MIN_MS) {
			const time = run.time;
			const cause = CAUSE_ORDER.reduce((best, actor) => (time[actor] > time[best] ? actor : best));
			gaps.push({ t0: run.t0, t1: run.t1, cause });
		}
		run = null;
	};
	for (const band of bands) {
		if (!IDLE_LIKE.has(band.actor)) {
			flush();
			continue;
		}
		const actor = band.actor as GapCause;
		if (!run || run.t1 !== band.t0)
			run = { t0: band.t0, t1: band.t1, time: { user: 0, background: 0, idle: 0 } };
		run.t1 = band.t1;
		run.time[actor] += band.t1 - band.t0;
	}
	flush();
	return gaps;
}

/** Totals of each actor's bands. */
export function waitTotals(bands: readonly WaitBand[]): Record<WaitActor, number> {
	const totals: Record<WaitActor, number> = {
		user: 0,
		model: 0,
		tool: 0,
		subagent: 0,
		background: 0,
		idle: 0,
	};
	for (const band of bands) totals[band.actor] += band.t1 - band.t0;
	return totals;
}

/** The time `actor` was waited on inside `t0..t1`. */
export function waitedWithin(
	bands: readonly WaitBand[],
	actor: WaitActor,
	t0: number,
	t1: number,
): number {
	let total = 0;
	for (const band of bands) {
		if (band.actor !== actor || band.t1 <= t0 || band.t0 >= t1) continue;
		total += Math.min(t1, band.t1) - Math.max(t0, band.t0);
	}
	return total;
}

export interface PackItem {
	id: string;
	t0: number;
	t1: number;
}

/**
 * Greedy interval packing by start time onto the first free track, at most `maxTracks`; overflow
 * shares the last track. Deterministic: ties order by end, then id.
 */
export function packTracks(
	items: readonly PackItem[],
	maxTracks: number,
): { tracks: number; of: Map<string, number> } {
	const sorted = [...items].sort(
		(a, b) => a.t0 - b.t0 || a.t1 - b.t1 || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
	);
	const ends: number[] = [];
	const of = new Map<string, number>();
	for (const item of sorted) {
		let track = ends.findIndex((free) => free <= item.t0);
		if (track < 0) {
			if (ends.length < maxTracks) {
				track = ends.length;
				ends.push(Number.NEGATIVE_INFINITY);
			} else track = ends.length - 1;
		}
		ends[track] = Math.max(ends[track] ?? 0, item.t1 > item.t0 ? item.t1 : item.t0 + 1);
		of.set(item.id, track);
	}
	return { tracks: ends.length, of };
}
