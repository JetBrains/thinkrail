import { stat } from "node:fs/promises";
import {
	CACHE_TTL_MS,
	DAY_TICK_MS,
	type DayHour,
	type DaySession,
	type DayTick,
	type DayTimelineParams,
	type DayTimelineResult,
	type DayTotals,
	type DayTurn,
	type Figure,
	type IndexState,
	type Interval,
	type LlmEvent,
	METRIC_SOURCES,
	type Origin,
	SESSION_INSIGHTS_API_VERSION,
	type TokenTotals,
	type ToolFamily,
} from "./core.ts";
import {
	listRows,
	parseSessionsListParams,
	placedSummaries,
	type SessionsListInput,
} from "./list.ts";
import { cacheMisses } from "./timeline.ts";
import { isRecord } from "./totals.ts";
import type { BuiltTrace } from "./trace.ts";

const HOUR_MS = 3_600_000;
const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const ROW_CAPACITY = 256;

/** What the day view draws of one session file, over its whole span; a day clips it. */
export interface DayRowData {
	turns: readonly DayTurn[];
	ticks: readonly DayTick[];
	warm: readonly Interval[];
	misses: readonly number[];
	userWaits: readonly Interval[];
}

export interface DayTimelineInput extends SessionsListInput {
	rows: DayRowCache;
	/** Builds (or returns a cached) trace of a session file. */
	trace(file: string): Promise<BuiltTrace | null>;
}

function pad(value: number, width = 2): string {
	return String(value).padStart(width, "0");
}

/** The host-local calendar day of a moment, `YYYY-MM-DD`. */
export function localDay(ms: number): string {
	const date = new Date(ms);
	return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Local midnight to the next local midnight, or `null` for a malformed or impossible date. */
export function dayWindow(day: string): Interval | null {
	const match = DAY_PATTERN.exec(day);
	if (!match) return null;
	const [year, month, date] = [Number(match[1]), Number(match[2]), Number(match[3])];
	const start = new Date(year, month - 1, date);
	if (start.getFullYear() !== year || start.getMonth() !== month - 1 || start.getDate() !== date)
		return null;
	return { t0: start.getTime(), t1: new Date(year, month - 1, date + 1).getTime() };
}

/** Every hour boundary of the window with its local hour, the window's end included. */
export function dayHours(window: Interval): DayHour[] {
	const hours: DayHour[] = [];
	for (let t = window.t0; t <= window.t1; t += HOUR_MS)
		hours.push({ t, hour: new Date(t).getHours() });
	const last = hours.at(-1);
	if (!last || last.t !== window.t1)
		hours.push({ t: window.t1, hour: new Date(window.t1).getHours() });
	return hours;
}

export function parseDayTimelineParams(value: unknown): DayTimelineParams {
	const { scope } = parseSessionsListParams(value);
	const day = isRecord(value) ? value.day : undefined;
	if (day === undefined) return { scope };
	if (typeof day !== "string" || dayWindow(day) === null)
		throw new Error("Invalid day.timeline params");
	return { scope, day };
}

function merge(intervals: Interval[]): Interval[] {
	intervals.sort((a, b) => a.t0 - b.t0 || a.t1 - b.t1);
	const out: Interval[] = [];
	for (const interval of intervals) {
		const last = out.at(-1);
		if (last && interval.t0 <= last.t1) last.t1 = Math.max(last.t1, interval.t1);
		else out.push({ ...interval });
	}
	return out;
}

const FAMILY_ORDER: readonly ToolFamily[] = [
	"discovery",
	"reading",
	"writing",
	"execution",
	"planning",
	"subagent",
	"ask",
	"other",
];

/** The day view's picture of a whole trace: turn bars, per-slot tool ticks, warm-cache stretches, misses, asks. */
export function dayRowData(trace: BuiltTrace, ttlMs: number = CACHE_TTL_MS): DayRowData {
	const turns: DayTurn[] = [];
	const slots = new Map<number, { counts: Map<ToolFamily, number>; n: number; errors: number }>();
	const warm: Interval[] = [];
	const userWaits: Interval[] = [];
	const calls: LlmEvent[] = [];
	for (const event of trace.events) {
		switch (event.kind) {
			case "turn":
				turns.push({
					id: event.id,
					n: event.n,
					trigger: event.trigger,
					t0: event.t0,
					t1: event.t1,
				});
				break;
			case "llm":
				calls.push(event);
				warm.push({ t0: event.t1, t1: event.t1 + ttlMs });
				break;
			case "tool": {
				if (event.family === "ask" && event.t1 > event.t0)
					userWaits.push({ t0: event.t0, t1: event.t1 });
				const slot = Math.floor(event.t0 / DAY_TICK_MS) * DAY_TICK_MS;
				let bucket = slots.get(slot);
				if (!bucket) {
					bucket = { counts: new Map(), n: 0, errors: 0 };
					slots.set(slot, bucket);
				}
				bucket.n += 1;
				if (event.error) bucket.errors += 1;
				bucket.counts.set(event.family, (bucket.counts.get(event.family) ?? 0) + 1);
				break;
			}
		}
	}
	const ticks: DayTick[] = [...slots]
		.sort(([a], [b]) => a - b)
		.map(([t, bucket]) => {
			let family: ToolFamily = "other";
			let best = -1;
			for (const candidate of FAMILY_ORDER) {
				const count = bucket.counts.get(candidate) ?? 0;
				if (count > best) {
					best = count;
					family = candidate;
				}
			}
			return { t, family, n: bucket.n, errors: bucket.errors };
		});
	const missed = cacheMisses(calls);
	return {
		turns,
		ticks,
		warm: merge(warm),
		misses: calls.filter((call) => missed.has(call.id)).map((call) => call.t0),
		userWaits: merge(userWaits),
	};
}

/** Day rows of recent file revisions, so paging through days does not rebuild every trace. */
export class DayRowCache {
	private readonly rows = new Map<string, DayRowData>();
	private readonly capacity: number;

	constructor(capacity = ROW_CAPACITY) {
		this.capacity = capacity;
	}

	async row(file: string, build: () => Promise<BuiltTrace | null>): Promise<DayRowData | null> {
		let key: string;
		try {
			const info = await stat(file);
			key = `${file}\u0000${info.size}\u0000${Math.round(info.mtimeMs)}`;
		} catch {
			return null;
		}
		const cached = this.rows.get(key);
		if (cached) {
			this.rows.delete(key);
			this.rows.set(key, cached);
			return cached;
		}
		const trace = await build();
		if (!trace) return null;
		const row = dayRowData(trace);
		this.rows.set(key, row);
		while (this.rows.size > this.capacity) {
			const oldest = this.rows.keys().next().value;
			if (oldest === undefined) break;
			this.rows.delete(oldest);
		}
		return row;
	}
}

function clip(intervals: readonly Interval[], window: Interval): Interval[] {
	return intervals.flatMap((interval) =>
		interval.t1 > window.t0 && interval.t0 < window.t1
			? [{ t0: Math.max(window.t0, interval.t0), t1: Math.min(window.t1, interval.t1) }]
			: [],
	);
}

function emptyHours(hours: readonly DayHour[], busy: readonly Interval[]): Interval[] {
	const gaps: Interval[] = [];
	for (let at = 0; at + 1 < hours.length; at++) {
		const t0 = hours[at]?.t ?? 0;
		const t1 = hours[at + 1]?.t ?? 0;
		if (busy.some((interval) => interval.t1 > t0 && interval.t0 < t1)) continue;
		const last = gaps.at(-1);
		if (last && last.t1 === t0) last.t1 = t1;
		else gaps.push({ t0, t1 });
	}
	return gaps;
}

function warmCount(rows: readonly Interval[][]): { t: number; count: number }[] {
	const points: [number, number][] = [];
	for (const intervals of rows)
		for (const interval of intervals) points.push([interval.t0, 1], [interval.t1, -1]);
	points.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
	const out: { t: number; count: number }[] = [];
	let count = 0;
	for (const [t, delta] of points) {
		count += delta;
		const last = out.at(-1);
		if (last && last.t === t) last.count = count;
		else out.push({ t, count });
	}
	return out;
}

function combined(origins: readonly Origin[]): Origin {
	if (origins.every((origin) => origin === "recorded")) return "recorded";
	if (origins.every((origin) => origin === "notRecorded")) return "notRecorded";
	return "partiallyRecorded";
}

function sum(figures: readonly Figure[]): Figure {
	return {
		value: figures.reduce((total, figure) => total + (figure.value ?? 0), 0),
		origin: "counted",
	};
}

function totalsOf(sessions: readonly DaySession[], misses: number): DayTotals {
	const tokens: TokenTotals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
	for (const session of sessions) {
		const value = session.tokens.value;
		if (!value) continue;
		tokens.input += value.input;
		tokens.output += value.output;
		tokens.cacheRead += value.cacheRead;
		tokens.cacheWrite += value.cacheWrite;
		tokens.total += value.total;
	}
	return {
		llmCalls: sum(sessions.map((session) => session.llmCalls)),
		toolCalls: sum(sessions.map((session) => session.toolCalls)),
		toolErrors: sum(sessions.map((session) => session.toolErrors)),
		tokens: { value: tokens, origin: "recorded" },
		cost: {
			value: sessions.reduce((total, session) => total + (session.cost.value ?? 0), 0),
			origin: combined(sessions.map((session) => session.cost.origin)),
		},
		cacheMisses: { value: misses, origin: "approximated" },
	};
}

function timeZone(): string {
	try {
		return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
	} catch {
		return "UTC";
	}
}

/**
 * Every session of the scope started on one host-local day, on a shared strip: turn bars, tool ticks,
 * the warm-cache stretches (a heuristic: `CACHE_TTL_MS` after each reply), cache misses and asks.
 */
export async function buildDayTimeline(
	input: DayTimelineInput,
	state: IndexState,
	params: DayTimelineParams,
): Promise<DayTimelineResult> {
	const placed = placedSummaries(input);
	const days = [
		...new Set(
			placed.flatMap(({ summary }) => (summary.start === null ? [] : [localDay(summary.start)])),
		),
	].sort();
	const day = params.day ?? days.at(-1) ?? null;
	const window = day ? dayWindow(day) : null;
	const empty: DayTimelineResult = {
		apiVersion: SESSION_INSIGHTS_API_VERSION,
		state,
		day,
		days,
		timeZone: timeZone(),
		start: window?.t0 ?? null,
		end: window?.t1 ?? null,
		hours: window ? dayHours(window) : [],
		gaps: [],
		warmCount: [],
		totals: null,
		cacheTtlMs: CACHE_TTL_MS,
		sessions: [],
		sources: METRIC_SOURCES,
	};
	if (!window) return empty;
	const rows = await listRows(
		input,
		(summary) => summary.start !== null && summary.start >= window.t0 && summary.start < window.t1,
	);
	const sessions: DaySession[] = [];
	const warm: Interval[][] = [];
	let misses = 0;
	for (const row of [...rows].sort(
		(a, b) => (a.start.value ?? 0) - (b.start.value ?? 0) || (a.sessionId < b.sessionId ? -1 : 1),
	)) {
		const summary = input.index.summaryOf(row.sessionId);
		if (!summary || summary.start === null) continue;
		const file = summary.file;
		const data = await input.rows.row(file, () => input.trace(file));
		const turns = data?.turns ?? [];
		const end =
			turns.length > 0
				? turns.reduce((latest, turn) => Math.max(latest, turn.t1), summary.start)
				: (summary.end ?? summary.start);
		const rowWarm = clip(data?.warm ?? [], window);
		const rowMisses = (data?.misses ?? []).filter((t) => t >= window.t0 && t < window.t1);
		warm.push(rowWarm);
		misses += rowMisses.length;
		sessions.push({
			sessionId: row.sessionId,
			title: row.title,
			firstPrompt: row.firstPrompt,
			projectId: row.projectId,
			workspaceName: row.workspaceName,
			live: row.live,
			start: summary.start,
			end,
			continues: end > window.t1,
			turns: turns.flatMap((turn) =>
				turn.t1 >= window.t0 && turn.t0 < window.t1
					? [{ ...turn, t0: Math.max(window.t0, turn.t0), t1: Math.min(window.t1, turn.t1) }]
					: [],
			),
			ticks: (data?.ticks ?? []).filter((tick) => tick.t >= window.t0 && tick.t < window.t1),
			warm: rowWarm,
			misses: rowMisses,
			userWaits: clip(data?.userWaits ?? [], window),
			cacheMisses: { value: rowMisses.length, origin: "approximated" },
			llmCalls: { value: summary.counts.assistantMessages, origin: "counted" },
			toolCalls: row.toolCalls,
			toolErrors: row.toolErrors,
			tokens: row.tokens,
			cost: row.cost,
			subagents: row.subagents,
		});
	}
	const busy = sessions.flatMap((session) =>
		session.turns.map((turn) => ({ t0: turn.t0, t1: Math.max(turn.t1, turn.t0 + 1) })),
	);
	return {
		...empty,
		gaps: sessions.length > 0 ? emptyHours(empty.hours, busy) : [],
		warmCount: warmCount(warm),
		totals: sessions.length > 0 ? totalsOf(sessions, misses) : null,
		sessions,
	};
}
