import { describe, expect, test } from "bun:test";
import { FORECAST_TRIALS, forecast, mulberry32, seedOf } from "./forecast";

const NOW = Date.parse("2026-11-18T15:00:00Z");

const base = {
	key: "p1:I-1",
	weeklyPoints: [2, 5, 0, 3, 4, 1],
	remainingPoints: 20,
	totalPoints: 30,
	now: NOW,
};

describe("the Monte Carlo forecast", () => {
	test("its seed and random numbers are stable", () => {
		expect(seedOf("abc")).toBe(seedOf("abc"));
		expect(seedOf("abc")).not.toBe(seedOf("abd"));
		const first = mulberry32(7);
		const second = mulberry32(7);
		const draws = Array.from({ length: 50 }, () => first());
		expect(Array.from({ length: 50 }, () => second())).toEqual(draws);
		expect(draws.every((value) => value >= 0 && value < 1)).toBe(true);
		expect(new Set(draws).size).toBe(50);
	});

	test("gives the same dates for the same data, and reseeds when the data or the initiative changes", () => {
		const once = forecast(base);
		expect(forecast(base)).toEqual(once);
		expect(forecast({ ...base, key: "p1:I-2" }).inputs.seed).not.toBe(once.inputs.seed);
		expect(forecast({ ...base, weeklyPoints: [2, 5, 0, 3, 4, 2] }).inputs.seed).not.toBe(
			once.inputs.seed,
		);
		expect(forecast({ ...base, remainingPoints: 19 }).inputs.seed).not.toBe(once.inputs.seed);
	});

	test("dates the 50 % and 85 % trials in weeks from today, and exposes its inputs", () => {
		const result = forecast(base);
		if (result.status !== "ok") throw new Error(`expected a forecast, got ${result.status}`);
		expect(result.p85Weeks).toBeGreaterThanOrEqual(result.p50Weeks);
		expect(result.p50Weeks).toBeGreaterThanOrEqual(Math.ceil(20 / 5));
		expect(result.p85 >= result.p50).toBe(true);
		expect(result.inputs).toEqual({
			weeklyPoints: [2, 5, 0, 3, 4, 1],
			remainingPoints: 20,
			totalPoints: 30,
			trials: FORECAST_TRIALS,
			seed: result.inputs.seed,
			from: "2026-11-18",
		});
	});

	test("a steady throughput gives one exact date", () => {
		const result = forecast({ ...base, weeklyPoints: [2, 2, 2], remainingPoints: 6 });
		expect(result).toMatchObject({
			status: "ok",
			p50Weeks: 3,
			p85Weeks: 3,
			p50: "2026-12-09",
			p85: "2026-12-09",
		});
	});

	test("says it has not enough data without scope, below three weeks or with no completion", () => {
		expect(forecast({ ...base, totalPoints: 0, remainingPoints: 0 })).toMatchObject({
			status: "insufficient",
			reason: "no-scope",
		});
		expect(forecast({ ...base, weeklyPoints: [3, 4] })).toMatchObject({
			status: "insufficient",
			reason: "history",
		});
		expect(forecast({ ...base, weeklyPoints: [0, 0, 0, 0] })).toMatchObject({
			status: "insufficient",
			reason: "no-completions",
		});
	});

	test("is done when nothing remains, whatever the history", () => {
		expect(forecast({ ...base, weeklyPoints: [], remainingPoints: 0 })).toMatchObject({
			status: "done",
		});
	});

	test("stops a trial after ten years", () => {
		const result = forecast({
			...base,
			weeklyPoints: [0, 0, 1],
			remainingPoints: 10_000,
			trials: 20,
		});
		expect(result).toMatchObject({ status: "ok", p85Weeks: 520 });
	});
});
