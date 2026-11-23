import { expect } from "bun:test";

/** Wall-clock budgets hold on a quiet machine: `SESSION_INSIGHTS_PERF=1` asserts them as documented. */
export const PERF = process.env.SESSION_INSIGHTS_PERF === "1";

/** The timeout of a test over a large synthetic session, so its ten-times ceiling, not bun's 5 s default, bounds it. */
export const LARGE_TEST_MS = 60_000;

/** Asserts a measured duration: the budget under `PERF`, else ten times it (a complexity regression still fails). */
export function withinBudget(elapsedMs: number, budgetMs: number): void {
	expect(elapsedMs).toBeLessThan(PERF ? budgetMs : budgetMs * 10);
}

/** The milliseconds `run` takes. */
export async function timed<T>(run: () => T | Promise<T>): Promise<{ value: T; ms: number }> {
	const started = performance.now();
	const value = await run();
	return { value, ms: performance.now() - started };
}

/**
 * `run`'s value and the longest the event loop went without a turn meanwhile: the widest gap between
 * a `setTimeout(…, 0)` ticker's turns, the stretch after its last turn included.
 */
export async function longestStall<T>(
	run: () => Promise<T>,
): Promise<{ value: T; stallMs: number }> {
	let stallMs = 0;
	let last = performance.now();
	let running = true;
	const tick = () => {
		const now = performance.now();
		stallMs = Math.max(stallMs, now - last);
		last = now;
		if (running) setTimeout(tick, 0);
	};
	setTimeout(tick, 0);
	try {
		const value = await run();
		return { value, stallMs: Math.max(stallMs, performance.now() - last) };
	} finally {
		running = false;
	}
}
