import type { PanelHost } from "@thinkrail/extension-api/web";
import { BoardReplyError } from "./api";

type Querying = Pick<PanelHost, "query">;

/** The cumulative flow's bands, bottom (done) to top (backlog). */
export const FLOW_CATEGORIES = ["completed", "review", "started", "unstarted", "backlog"] as const;
export type FlowCategory = (typeof FLOW_CATEGORIES)[number];

/** The windows the Insights view offers, in weeks. */
export const INSIGHT_WINDOWS = [4, 12, 26] as const;
export type InsightWindow = (typeof INSIGHT_WINDOWS)[number];

export interface InsightsDay {
	day: number;
	wip: number;
	flow: Record<FlowCategory, number>;
}

/** `insights.get` as the server answers it (see the server's `insights.ts`). */
export interface Insights {
	from: number;
	to: number;
	weeks: number;
	days: InsightsDay[];
	throughput: { start: number; cards: number; partial: boolean }[];
	cycleTimes: { cardId: string; completedAt: number; days: number }[];
	cycle: { p50: number | null; p85: number | null };
	aging: { cardId: string; category: "started" | "review"; days: number }[];
	sle: number | null;
	time: { agent: number; waiting: number; review: number };
	empty: boolean;
}

const HOUR_MS = 60 * 60 * 1000;

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isInsights(value: unknown): value is Insights {
	return (
		isObject(value) &&
		typeof value.from === "number" &&
		typeof value.to === "number" &&
		Array.isArray(value.days) &&
		Array.isArray(value.throughput) &&
		Array.isArray(value.cycleTimes) &&
		isObject(value.cycle) &&
		Array.isArray(value.aging) &&
		isObject(value.time) &&
		typeof value.empty === "boolean"
	);
}

export async function loadInsights(
	host: Querying,
	projectId: string,
	weeks: number,
	signal?: AbortSignal,
): Promise<Insights> {
	const value = await host.query("insights.get", { projectId, weeks }, signal);
	if (!isInsights(value))
		throw new BoardReplyError("The board's host replied in an unknown shape.");
	return value;
}

/** A linear map from `domain` onto `range`; a zero-width domain maps to the range's start. */
export function scale(
	domain: readonly [number, number],
	range: readonly [number, number],
): (value: number) => number {
	const [d0, d1] = domain;
	const [r0, r1] = range;
	const span = d1 - d0;
	return (value) => (span === 0 ? r0 : r0 + ((value - d0) / span) * (r1 - r0));
}

/** The axis maximum: the smallest 1, 2 or 5 × 10ⁿ at or above `value` (1 for nothing). */
export function niceMax(value: number): number {
	if (!(value > 0)) return 1;
	const power = 10 ** Math.floor(Math.log10(value));
	for (const step of [1, 2, 5, 10]) if (step * power >= value) return step * power;
	return 10 * power;
}

/** Ticks from 0 to the axis maximum, with the middle one only where it is not a fraction of a whole count. */
export function ticks(max: number): number[] {
	return Number.isInteger(max) && max % 2 === 1 ? [0, max] : [0, max / 2, max];
}

const rounded = (value: number) => Math.round(value * 10) / 10;

/** An SVG polyline path through the points. */
export function linePath(points: readonly { x: number; y: number }[]): string {
	return points
		.map((point, index) => `${index === 0 ? "M" : "L"}${rounded(point.x)},${rounded(point.y)}`)
		.join(" ");
}

/** The cumulative flow's bands: per category its lower and upper count at each day, done at the bottom. */
export function flowBands(
	days: readonly InsightsDay[],
): { category: FlowCategory; lower: number[]; upper: number[] }[] {
	const base = days.map(() => 0);
	return FLOW_CATEGORIES.map((category) => {
		const lower = [...base];
		const upper = days.map((day, index) => (base[index] ?? 0) + day.flow[category]);
		upper.forEach((value, index) => {
			base[index] = value;
		});
		return { category, lower, upper };
	});
}

/** A closed area between an upper and a lower line over the same x positions. */
export function bandPath(
	xs: readonly number[],
	upper: readonly number[],
	lower: readonly number[],
) {
	const top = xs.map((x, index) => ({ x, y: upper[index] ?? 0 }));
	const bottom = xs.map((x, index) => ({ x, y: lower[index] ?? 0 })).reverse();
	return `${linePath([...top, ...bottom])} Z`;
}

/** The flow's highest stacked total, for the CFD's axis. */
export function flowMax(days: readonly InsightsDay[]): number {
	return Math.max(
		0,
		...days.map((day) => FLOW_CATEGORIES.reduce((sum, category) => sum + day.flow[category], 0)),
	);
}

/** Where in-progress time went, in hours and as shares of the whole (percent, rounded). */
export function timeSplit(time: Insights["time"]): {
	key: keyof Insights["time"];
	hours: number;
	percent: number;
	start: number;
}[] {
	const total = time.agent + time.waiting + time.review;
	let start = 0;
	return (["agent", "waiting", "review"] as const).map((key) => {
		const share = total > 0 ? (100 * time[key]) / total : 0;
		const entry = { key, hours: rounded(time[key] / HOUR_MS), percent: Math.round(share), start };
		start += share;
		return entry;
	});
}

/** Spreads a column's dots sideways by their order, so equal ages stay apart; deterministic. */
export function spread(index: number, count: number, width: number): number {
	if (count <= 1) return 0;
	return ((index % 5) / 4 - 0.5) * width;
}

/** Whether a chart has anything to draw. */
export function chartData(
	insights: Insights,
): Record<"wip" | "throughput" | "cycle" | "aging" | "flow" | "time", boolean> {
	return {
		wip: !insights.empty && insights.days.some((day) => day.wip > 0),
		throughput: insights.throughput.some((week) => week.cards > 0),
		cycle: insights.cycleTimes.length > 0,
		aging: insights.aging.length > 0,
		flow: !insights.empty && flowMax(insights.days) > 0,
		time: insights.time.agent + insights.time.waiting + insights.time.review > 0,
	};
}
