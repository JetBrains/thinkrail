import type { Rate } from "./core.ts";

const Z95 = 1.959963984540054;

/** Strings by UTF-16 code units: the same order on every runtime and locale (`localeCompare` is neither). */
export function byText(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}

/** The 95 % Wilson score interval of `k` successes in `n` trials; `null` when `n` is 0. */
export function wilson(k: number, n: number, z: number = Z95): Rate | null {
	if (n <= 0) return null;
	const p = k / n;
	const z2 = z * z;
	const denominator = 1 + z2 / n;
	const centre = (p + z2 / (2 * n)) / denominator;
	const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denominator;
	return {
		k,
		n,
		low: k <= 0 ? 0 : Math.max(0, centre - half),
		high: k >= n ? 1 : Math.min(1, centre + half),
	};
}

/** The middle of ascending values: the middle one for an odd count, the mean of the middle two for an even one. */
function middleOf(sorted: ArrayLike<number>): number {
	const middle = (sorted.length - 1) / 2;
	return ((sorted[Math.floor(middle)] ?? 0) + (sorted[Math.ceil(middle)] ?? 0)) / 2;
}

/**
 * The median of the values: the middle one for an odd count, the mean of the middle two for an even
 * one; `null` when empty. Every figure the package labels a median or p50 comes from here.
 */
export function median(values: readonly number[]): number | null {
	if (values.length === 0) return null;
	return middleOf([...values].sort((a, b) => a - b));
}

export function mean(values: readonly number[]): number | null {
	if (values.length === 0) return null;
	return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Values more than `factor` times the median of the positive values, given at least `min` of them. */
export function outliers<T>(
	items: readonly T[],
	value: (item: T) => number,
	factor: number,
	min: number,
): { median: number; items: T[] } | null {
	const positive = items.filter((item) => value(item) > 0);
	if (positive.length < min) return null;
	const middle = median(positive.map(value)) ?? 0;
	if (middle <= 0) return null;
	return { median: middle, items: positive.filter((item) => value(item) > factor * middle) };
}

/** Every calendar day from `first` to `last` (`YYYY-MM-DD`, inclusive), in order. */
export function dayRange(first: string, last: string): string[] {
	const parse = (day: string) => {
		const [year, month, date] = day.split("-").map(Number);
		return new Date(year ?? 1970, (month ?? 1) - 1, date ?? 1);
	};
	const out: string[] = [];
	const end = parse(last).getTime();
	for (let at = parse(first); at.getTime() <= end; at.setDate(at.getDate() + 1)) {
		const pad = (value: number, width = 2) => String(value).padStart(width, "0");
		out.push(`${pad(at.getFullYear(), 4)}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`);
		if (out.length > 3700) break;
	}
	return out;
}

/** FNV-1a over the text: a 32-bit seed for `mulberry32`. */
export function seedOf(text: string): number {
	let hash = 0x811c9dc5;
	for (let at = 0; at < text.length; at++) {
		hash ^= text.charCodeAt(at);
		hash = Math.imul(hash, 0x01000193);
	}
	return hash >>> 0;
}

/** A small seeded PRNG (Mulberry32): uniform numbers in [0, 1), the same sequence for the same seed. */
export function mulberry32(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** A sample's per-session values; a `ratio` statistic divides the sum of `values` by the sum of `weights`. */
export interface BootSample {
	values: readonly number[];
	weights?: readonly number[];
}

export type BootStat = "median" | "mean" | "ratio";

export function statOf(kind: BootStat, sample: BootSample): number | null {
	const { values, weights } = sample;
	if (values.length === 0) return null;
	if (kind === "median") return median(values);
	if (kind === "mean") return mean(values);
	let numerator = 0;
	let denominator = 0;
	values.forEach((value, at) => {
		numerator += value;
		denominator += weights?.[at] ?? 0;
	});
	return denominator > 0 ? numerator / denominator : null;
}

function resampled(
	kind: BootStat,
	sample: BootSample,
	random: () => number,
	scratch: Float64Array,
): number {
	const n = sample.values.length;
	if (kind === "ratio") {
		let numerator = 0;
		let denominator = 0;
		for (let k = 0; k < n; k++) {
			const at = Math.floor(random() * n);
			numerator += sample.values[at] ?? 0;
			denominator += sample.weights?.[at] ?? 0;
		}
		return denominator > 0 ? numerator / denominator : Number.NaN;
	}
	let sum = 0;
	for (let k = 0; k < n; k++) {
		const value = sample.values[Math.floor(random() * n)] ?? 0;
		scratch[k] = value;
		sum += value;
	}
	if (kind === "mean") return sum / n;
	return middleOf(scratch.subarray(0, n).sort());
}

/**
 * A percentile bootstrap interval of `stat(b) − stat(a)`: each resample draws both samples' sessions
 * with replacement from a PRNG seeded with `seed`, so the interval is a pure function of its inputs. It
 * yields to the event loop every `sliceMs`, which never changes the draws.
 */
export async function bootstrapDifference(
	kind: BootStat,
	a: BootSample,
	b: BootSample,
	options: { resamples: number; seed: number; level: number; sliceMs?: number },
): Promise<{ low: number; high: number } | null> {
	if (a.values.length === 0 || b.values.length === 0) return null;
	const random = mulberry32(options.seed);
	const scratch = new Float64Array(Math.max(a.values.length, b.values.length));
	const differences: number[] = [];
	const sliceMs = options.sliceMs ?? 8;
	let slice = performance.now();
	for (let k = 0; k < options.resamples; k++) {
		const left = resampled(kind, a, random, scratch);
		const right = resampled(kind, b, random, scratch);
		const difference = right - left;
		if (Number.isFinite(difference)) differences.push(difference);
		if (k % 32 === 31 && performance.now() - slice > sliceMs) {
			await new Promise((resolve) => setTimeout(resolve, 0));
			slice = performance.now();
		}
	}
	if (differences.length === 0) return null;
	differences.sort((x, y) => x - y);
	const tail = (1 - options.level) / 2;
	const last = differences.length - 1;
	return {
		low: differences[Math.floor(tail * last)] ?? 0,
		high: differences[Math.ceil((1 - tail) * last)] ?? 0,
	};
}
