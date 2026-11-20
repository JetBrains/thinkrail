import { isoOfDay, today } from "./days";
import { MIN_HISTORY_WEEKS } from "./throughput";

export const FORECAST_TRIALS = 2000;
/** A trial that has not finished after ten years stops there. */
const MAX_WEEKS = 520;

/** What a forecast was computed from, for the "why this date" explanation. */
export interface ForecastInputs {
	/** The sampled weeks' completed size points, oldest first. */
	weeklyPoints: number[];
	remainingPoints: number;
	totalPoints: number;
	trials: number;
	seed: number;
	/** The day the weeks are counted from, an ISO date. */
	from: string;
}

export type Forecast =
	| {
			status: "ok";
			p50: string;
			p85: string;
			p50Weeks: number;
			p85Weeks: number;
			inputs: ForecastInputs;
	  }
	| { status: "done"; inputs: ForecastInputs }
	| {
			status: "insufficient";
			reason: "no-scope" | "history" | "no-completions";
			inputs: ForecastInputs;
	  };

/** FNV-1a over the text: the forecast's seed, so the same data gives the same dates. */
export function seedOf(text: string): number {
	let hash = 0x811c9dc5;
	for (let index = 0; index < text.length; index += 1) {
		hash ^= text.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}
	return hash;
}

/** A small seeded RNG (mulberry32) answering numbers in [0, 1). */
export function mulberry32(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let value = state;
		value = Math.imul(value ^ (value >>> 15), value | 1);
		value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
		return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
	};
}

const percentile = (sorted: readonly number[], share: number) =>
	sorted[Math.max(0, Math.ceil(share * sorted.length) - 1)] ?? 0;

/**
 * A Monte Carlo forecast of when the remaining points are done: each trial draws past weeks' completed
 * points until they cover what remains; the 50 % and 85 % trials' week counts, from today, are the dates.
 * Seeded from `key` and the data, so it is stable until the data changes. Not enough data without scope,
 * below three weeks of history or with no completion.
 */
export function forecast(input: {
	key: string;
	weeklyPoints: readonly number[];
	remainingPoints: number;
	totalPoints: number;
	now: number;
	trials?: number;
}): Forecast {
	const trials = input.trials ?? FORECAST_TRIALS;
	const day = today(input.now);
	const seed = seedOf(
		`${input.key}|${input.weeklyPoints.join(",")}|${input.remainingPoints}|${input.totalPoints}`,
	);
	const inputs: ForecastInputs = {
		weeklyPoints: [...input.weeklyPoints],
		remainingPoints: input.remainingPoints,
		totalPoints: input.totalPoints,
		trials,
		seed,
		from: isoOfDay(day),
	};
	if (input.totalPoints <= 0) return { status: "insufficient", reason: "no-scope", inputs };
	if (input.remainingPoints <= 0) return { status: "done", inputs };
	if (input.weeklyPoints.length < MIN_HISTORY_WEEKS)
		return { status: "insufficient", reason: "history", inputs };
	if (!input.weeklyPoints.some((points) => points > 0))
		return { status: "insufficient", reason: "no-completions", inputs };
	const random = mulberry32(seed);
	const weeks: number[] = [];
	for (let trial = 0; trial < trials; trial += 1) {
		let left = input.remainingPoints;
		let count = 0;
		while (left > 0 && count < MAX_WEEKS) {
			left -= input.weeklyPoints[Math.floor(random() * input.weeklyPoints.length)] ?? 0;
			count += 1;
		}
		weeks.push(count);
	}
	weeks.sort((a, b) => a - b);
	const p50Weeks = percentile(weeks, 0.5);
	const p85Weeks = percentile(weeks, 0.85);
	const dateAfter = (count: number) => isoOfDay(day + count * 7);
	return {
		status: "ok",
		p50: dateAfter(p50Weeks),
		p85: dateAfter(p85Weeks),
		p50Weeks,
		p85Weeks,
		inputs,
	};
}
