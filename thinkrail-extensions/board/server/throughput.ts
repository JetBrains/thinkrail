import { WEEK_MS, weekStart } from "./days";
import type { Transition } from "./model";

/** Below this many whole weeks of history the forecast says it has not enough data. */
export const MIN_HISTORY_WEEKS = 3;

export interface ThroughputWeek {
	/** Monday 00:00 UTC, in ms. */
	start: number;
	cards: number;
	points: number;
}

export interface Throughput {
	/** The whole weeks from the log's first week to the last one before `now`'s, oldest first. */
	weeks: ThroughputWeek[];
	/** Cards completed in those weeks. */
	completed: number;
	insufficientData: boolean;
}

/**
 * When each card was completed: its last move into completed, unless it left completed again later (a
 * deletion keeps it, since the work was done).
 */
export function completions(transitions: readonly Transition[]): Map<string, number> {
	const done = new Map<string, number>();
	for (const transition of [...transitions].sort((a, b) => a.at - b.at)) {
		const { cardId, from, to } = transition;
		if (to?.category === "completed" && from?.category !== "completed")
			done.set(cardId, transition.at);
		else if (from?.category === "completed" && to !== null && to.category !== "completed")
			done.delete(cardId);
	}
	return done;
}

/** Each card's first and latest move into started (from another category), in ms. */
export function starts(
	transitions: readonly Transition[],
): Map<string, { first: number; last: number }> {
	const spans = new Map<string, { first: number; last: number }>();
	for (const transition of [...transitions].sort((a, b) => a.at - b.at)) {
		if (transition.to?.category !== "started" || transition.from?.category === "started") continue;
		const known = spans.get(transition.cardId);
		spans.set(transition.cardId, { first: known?.first ?? transition.at, last: transition.at });
	}
	return spans;
}

/** Each completed card's cycle time: from its first move into started to its completion, in ms. */
export function cycleTimes(transitions: readonly Transition[]): Map<string, number> {
	const started = starts(transitions);
	const times = new Map<string, number>();
	for (const [cardId, at] of completions(transitions)) {
		const since = started.get(cardId)?.first;
		if (since !== undefined && since <= at) times.set(cardId, at - since);
	}
	return times;
}

/**
 * Completed cards per whole week, counted and weighed in size points, from the log's first week to the
 * week before `now`'s (the current week is partial). Not enough data below three weeks or with no
 * completion in them.
 */
export function throughput(
	transitions: readonly Transition[],
	pointsOf: (cardId: string) => number,
	now: number,
): Throughput {
	const current = weekStart(now);
	const first = Math.min(...transitions.map((transition) => transition.at));
	const weeks: ThroughputWeek[] = [];
	if (Number.isFinite(first))
		for (let start = weekStart(first); start < current; start += WEEK_MS)
			weeks.push({ start, cards: 0, points: 0 });
	let completed = 0;
	for (const [cardId, at] of completions(transitions)) {
		const week = weeks.find((candidate) => candidate.start === weekStart(at));
		if (!week) continue;
		week.cards += 1;
		week.points += pointsOf(cardId);
		completed += 1;
	}
	return {
		weeks,
		completed,
		insufficientData: weeks.length < MIN_HISTORY_WEEKS || completed === 0,
	};
}
