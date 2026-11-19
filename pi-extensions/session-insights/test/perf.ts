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
