import { DAY_MS, WEEK_MS, weekStart } from "./days";
import type { Category, Transition } from "./model";
import { completions, starts } from "./throughput";

/** The categories the cumulative flow diagram stacks, bottom (done) to top (backlog). */
export const FLOW_CATEGORIES = ["completed", "review", "started", "unstarted", "backlog"] as const;
export type FlowCategory = (typeof FLOW_CATEGORIES)[number];

/** Below this many completed cards in the window the cycle-time percentiles (and the SLE) are absent. */
export const MIN_CYCLE_SAMPLES = 3;
export const INSIGHTS_MAX_WEEKS = 52;

/** A card as the insights read it now: its category and, while its agent waits for the human, since when. */
export interface InsightsCard {
	id: string;
	category: Category;
	/** The latest attempt's chat waits for the human (`needs_you`) since then. */
	waitingSince?: number;
}

export interface InsightsDay {
	/** UTC midnight, in ms. */
	day: number;
	/** Cards started or in review at the day's end (now, for today). */
	wip: number;
	/** Cards per flow category at the day's end. */
	flow: Record<FlowCategory, number>;
}

export interface Insights {
	/** The window: Monday 00:00 UTC `weeks - 1` weeks before this week's, to now. */
	from: number;
	to: number;
	weeks: number;
	days: InsightsDay[];
	/** Completed cards per week of the window, the current (partial) week last. */
	throughput: { start: number; cards: number; partial: boolean }[];
	/** Each card completed inside the window: when, and its cycle time in days (first start → done). */
	cycleTimes: { cardId: string; completedAt: number; days: number }[];
	/** Nearest-rank percentiles of those cycle times, in days; `null` below `MIN_CYCLE_SAMPLES`. */
	cycle: { p50: number | null; p85: number | null };
	/** The cards started or in review now, with their age in days since their first start. */
	aging: { cardId: string; category: "started" | "review"; days: number }[];
	/** The service level expectation: the 85th percentile cycle time, in days. */
	sle: number | null;
	/**
	 * Where the window's in-progress time went, in ms: started time minus the open waits for the human
	 * (agent working), those waits (waiting for you), and review time (in review).
	 */
	time: { agent: number; waiting: number; review: number };
	/** The log has no move inside the window at all. */
	empty: boolean;
}

/** The nearest-rank percentile `p` (0–1) of `values`; `null` for none. */
export function percentile(values: readonly number[], p: number): number | null {
	if (values.length === 0) return null;
	const sorted = [...values].sort((a, b) => a - b);
	const rank = Math.min(sorted.length, Math.max(1, Math.ceil(p * sorted.length)));
	return sorted[rank - 1] ?? null;
}

const round = (value: number) => Math.round(value * 100) / 100;

function emptyFlow(): Record<FlowCategory, number> {
	return { completed: 0, review: 0, started: 0, unstarted: 0, backlog: 0 };
}

/**
 * The board's flow over the last `weeks` weeks, from the transition log replayed day by day: WIP and the
 * cumulative flow at each day's end, weekly throughput, cycle times with their 50 / 85 % percentiles,
 * the age of the work in progress against the SLE, and where in-progress time went. Pure: the cards'
 * current waits come in as `waitingSince`, never from a clock.
 */
export function insights(input: {
	transitions: readonly Transition[];
	cards: readonly InsightsCard[];
	now: number;
	weeks: number;
}): Insights {
	const { now } = input;
	const weeks = Math.min(INSIGHTS_MAX_WEEKS, Math.max(1, Math.floor(input.weeks)));
	const from = weekStart(now) - (weeks - 1) * WEEK_MS;
	const log = [...input.transitions].sort((a, b) => a.at - b.at);

	const where = new Map<string, Category>();
	const counts = new Map<Category, number>();
	const shift = (category: Category | undefined, by: number) => {
		if (category) counts.set(category, (counts.get(category) ?? 0) + by);
	};
	const apply = (transition: Transition) => {
		shift(where.get(transition.cardId), -1);
		const to = transition.to?.category;
		if (to) where.set(transition.cardId, to);
		else where.delete(transition.cardId);
		shift(to, 1);
	};

	const spent = { agent: 0, waiting: 0, review: 0 };
	const entered = new Map<string, { category: Category; at: number }>();
	const close = (cardId: string, at: number) => {
		const open = entered.get(cardId);
		if (!open) return;
		const span = Math.max(0, at - Math.max(open.at, from));
		if (at > from && open.category === "started") spent.agent += span;
		if (at > from && open.category === "review") spent.review += span;
	};

	const days: InsightsDay[] = [];
	let index = 0;
	let moved = false;
	for (let day = from; day <= now; day += DAY_MS) {
		const end = Math.min(day + DAY_MS, now + 1);
		for (; index < log.length && (log[index]?.at ?? Infinity) < end; index += 1) {
			const transition = log[index];
			if (!transition) continue;
			if (transition.at >= from) moved = true;
			close(transition.cardId, transition.at);
			apply(transition);
			const to = transition.to?.category;
			if (to) entered.set(transition.cardId, { category: to, at: transition.at });
			else entered.delete(transition.cardId);
		}
		const flow = emptyFlow();
		for (const category of FLOW_CATEGORIES) flow[category] = counts.get(category) ?? 0;
		days.push({ day, wip: flow.started + flow.review, flow });
	}
	for (const cardId of entered.keys()) close(cardId, now);

	for (const card of input.cards) {
		if (card.category !== "started" || card.waitingSince === undefined) continue;
		const open = entered.get(card.id);
		if (open?.category !== "started") continue;
		const wait = Math.max(0, now - Math.max(card.waitingSince, open.at, from));
		const taken = Math.min(wait, spent.agent);
		spent.waiting += taken;
		spent.agent -= taken;
	}

	const throughputWeeks = Array.from({ length: weeks }, (_, offset) => ({
		start: from + offset * WEEK_MS,
		cards: 0,
		partial: offset === weeks - 1,
	}));
	const firstStart = starts(log);
	const cycleTimes: Insights["cycleTimes"] = [];
	for (const [cardId, at] of completions(log)) {
		if (at < from || at > now) continue;
		const week = throughputWeeks[Math.floor((weekStart(at) - from) / WEEK_MS)];
		if (week) week.cards += 1;
		const since = firstStart.get(cardId)?.first;
		if (since !== undefined && since <= at)
			cycleTimes.push({ cardId, completedAt: at, days: round((at - since) / DAY_MS) });
	}
	cycleTimes.sort((a, b) => a.completedAt - b.completedAt || a.cardId.localeCompare(b.cardId));
	const samples = cycleTimes.map((entry) => entry.days);
	const enough = samples.length >= MIN_CYCLE_SAMPLES;
	const p50 = enough ? percentile(samples, 0.5) : null;
	const p85 = enough ? percentile(samples, 0.85) : null;

	const aging: Insights["aging"] = [];
	for (const card of input.cards) {
		if (card.category !== "started" && card.category !== "review") continue;
		const since = firstStart.get(card.id)?.first;
		if (since === undefined || since > now) continue;
		aging.push({ cardId: card.id, category: card.category, days: round((now - since) / DAY_MS) });
	}
	aging.sort((a, b) => b.days - a.days || a.cardId.localeCompare(b.cardId));

	return {
		from,
		to: now,
		weeks,
		days,
		throughput: throughputWeeks,
		cycleTimes,
		cycle: { p50, p85 },
		aging,
		sle: p85,
		time: { agent: spent.agent, waiting: spent.waiting, review: spent.review },
		empty: !moved,
	};
}
