import type {
	DaySession,
	DayTimelineResult,
	DayTurn,
	TraceGap,
} from "@thinkrail/pi-session-insights/core";
import { type AxisScale, TimeScale } from "../trace/scale";

export const DAY_HEADER_PX = 26;
export const WARM_ROW_PX = 30;
export const ROW_PX = 40;
const MIN_BREAK_MS = 10 * 60_000;
const BREAK_SHARE = 0.03;
const HIT_SLACK_PX = 3;

/** The day's strip: the whole day with every empty hour compressed into a narrow labelled break. */
export function dayScale(day: DayTimelineResult): AxisScale | null {
	if (day.start === null || day.end === null) return null;
	const gaps: TraceGap[] = day.gaps.map((gap) => ({ ...gap, cause: "idle" }));
	const empty = gaps.reduce((sum, gap) => sum + (gap.t1 - gap.t0), 0);
	const width = Math.max(MIN_BREAK_MS, (day.end - day.start - empty) * BREAK_SHARE);
	return new TimeScale(day.start, day.end, gaps, 0, width);
}

export function dayX(scale: AxisScale, width: number, time: number): number {
	return ((scale.toUnit(time) - scale.min) / (scale.max - scale.min || 1)) * width;
}

export type DayHit =
	| { kind: "warm"; t: number; count: number }
	| { kind: "row"; row: number; session: DaySession; turn: DayTurn | null; t: number };

/** What is under a body-canvas point: the warm-cache row, or a session row and the turn at the pointer. */
export function hitDay(
	day: DayTimelineResult,
	scale: AxisScale,
	width: number,
	x: number,
	y: number,
): DayHit | null {
	const unit = scale.min + (x / Math.max(1, width)) * (scale.max - scale.min);
	const t = scale.toTime(unit);
	if (y < 0) return null;
	if (y < WARM_ROW_PX) {
		let count = 0;
		for (const point of day.warmCount) {
			if (point.t > t) break;
			count = point.count;
		}
		return { kind: "warm", t, count };
	}
	const row = Math.floor((y - WARM_ROW_PX) / ROW_PX);
	const session = day.sessions[row];
	if (!session) return null;
	let turn: DayTurn | null = null;
	for (const candidate of session.turns) {
		const x0 = dayX(scale, width, candidate.t0);
		const x1 = Math.max(x0 + 2, dayX(scale, width, candidate.t1));
		if (x >= x0 - HIT_SLACK_PX && x <= x1 + HIT_SLACK_PX) {
			turn = candidate;
			break;
		}
	}
	return { kind: "row", row, session, turn, t };
}
