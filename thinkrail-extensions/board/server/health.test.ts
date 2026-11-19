import { describe, expect, test } from "bun:test";
import { DAY_MS } from "./days";
import type { Forecast, ForecastInputs } from "./forecast";
import {
	type HealthCard,
	type HealthInput,
	type HealthReason,
	STALE_WAIT_MS,
	suggestHealth,
} from "./health";
import type { Health } from "./model";

const NOW = Date.parse("2026-11-18T12:00:00Z");
const inputs: ForecastInputs = {
	weeklyPoints: [],
	remainingPoints: 0,
	totalPoints: 0,
	trials: 0,
	seed: 0,
	from: "2026-11-18",
};
const predicted = (p85: string): Forecast => ({
	status: "ok",
	p50: p85,
	p85,
	p50Weeks: 1,
	p85Weeks: 1,
	inputs,
});
const card = (id: string, overrides: Partial<HealthCard> = {}): HealthCard => ({
	id,
	category: "backlog",
	critical: false,
	blocked: false,
	...overrides,
});

function input(overrides: Partial<HealthInput> = {}): HealthInput {
	return {
		start: Date.parse("2026-11-01T09:00:00Z"),
		forecast: { status: "insufficient", reason: "history", inputs },
		cards: [],
		reviewWip: { count: 0, limit: 5 },
		timeSpentMs: 0,
		now: NOW,
		...overrides,
	};
}

describe("the suggested health", () => {
	const table: [string, Partial<HealthInput>, Health, HealthReason["kind"][]][] = [
		["nothing wrong", {}, "on_track", []],
		[
			"a forecast on target",
			{ target: "2026-12-01", forecast: predicted("2026-12-01") },
			"on_track",
			[],
		],
		[
			"a forecast past the target within a quarter of the span",
			{ target: "2026-12-01", forecast: predicted("2026-12-08") },
			"at_risk",
			["forecast_late"],
		],
		[
			"a forecast past the target by more than a quarter of the span",
			{ target: "2026-12-01", forecast: predicted("2026-12-09") },
			"off_track",
			["forecast_late"],
		],
		["no target, so no forecast signal", { forecast: predicted("2027-06-01") }, "on_track", []],
		["not enough data, so no forecast signal", { target: "2026-11-20" }, "on_track", []],
		[
			"a critical card blocked while it is wanted",
			{ cards: [card("A", { critical: true, blocked: true, category: "unstarted" })] },
			"at_risk",
			["blocked"],
		],
		[
			"a blocked critical card still in the backlog, or a blocked card off the path",
			{
				cards: [
					card("A", { critical: true, blocked: true }),
					card("B", { blocked: true, category: "unstarted" }),
				],
			},
			"on_track",
			[],
		],
		[
			"a wait for the human older than a day on the critical path",
			{
				cards: [
					card("A", {
						critical: true,
						category: "started",
						agent: "waiting",
						waitingSince: NOW - STALE_WAIT_MS - 1,
					}),
				],
			},
			"at_risk",
			["waiting"],
		],
		[
			"a fresh wait, or an old one off the path",
			{
				cards: [
					card("A", {
						critical: true,
						category: "started",
						agent: "waiting",
						waitingSince: NOW - 1000,
					}),
					card("B", {
						category: "started",
						agent: "waiting",
						waitingSince: NOW - 3 * STALE_WAIT_MS,
					}),
				],
			},
			"on_track",
			[],
		],
		[
			"Review over its limit with this initiative's card in it",
			{ reviewWip: { count: 6, limit: 5 }, cards: [card("A", { category: "review" })] },
			"at_risk",
			["review_wip"],
		],
		[
			"Review over its limit without this initiative's cards, or with no limit",
			{ reviewWip: { count: 6, limit: 5 }, cards: [card("A", { category: "started" })] },
			"on_track",
			[],
		],
		[
			"a failed attempt",
			{ cards: [card("A", { category: "started", agent: "failed" })] },
			"at_risk",
			["failed"],
		],
		[
			"a failed attempt on a finished card",
			{ cards: [card("A", { category: "completed", agent: "failed" })] },
			"on_track",
			[],
		],
		[
			"appetite past 80 %",
			{ appetiteDays: 10, timeSpentMs: 8.5 * DAY_MS },
			"at_risk",
			["appetite"],
		],
		["appetite at 80 %", { appetiteDays: 10, timeSpentMs: 8 * DAY_MS }, "on_track", []],
		[
			"the worst signal wins",
			{
				target: "2026-12-01",
				forecast: predicted("2027-01-01"),
				cards: [card("A", { category: "started", agent: "failed" })],
			},
			"off_track",
			["forecast_late", "failed"],
		],
	];

	for (const [name, overrides, suggested, kinds] of table)
		test(name, () => {
			const health = suggestHealth(input(overrides));
			expect(health.suggested).toBe(suggested);
			expect(health.effective).toBe(health.suggested);
			expect(health.reasons.map((reason) => reason.kind)).toEqual(kinds);
		});

	test("reasons carry what the web half words them with", () => {
		const health = suggestHealth(
			input({
				target: "2026-12-01",
				forecast: predicted("2026-12-08"),
				reviewWip: { count: 7, limit: 5 },
				appetiteDays: 2,
				timeSpentMs: 3 * DAY_MS,
				cards: [
					card("A", { category: "review" }),
					card("B", { critical: true, blocked: true, category: "unstarted" }),
					card("C", { category: "started", agent: "failed" }),
				],
			}),
		);
		expect(health.reasons).toEqual([
			{ kind: "forecast_late", level: "at_risk", p85: "2026-12-08", target: "2026-12-01" },
			{ kind: "blocked", level: "at_risk", cardIds: ["B"] },
			{ kind: "review_wip", level: "at_risk", count: 7, limit: 5 },
			{ kind: "failed", level: "at_risk", cardIds: ["C"] },
			{ kind: "appetite", level: "at_risk", usedPercent: 150 },
		]);
	});

	test("a human's override wins over the suggestion, which stays visible with its reasons", () => {
		const health = suggestHealth(
			input({
				override: "on_track",
				note: "Known slip, agreed",
				cards: [card("A", { category: "started", agent: "failed" })],
			}),
		);
		expect(health).toEqual({
			suggested: "at_risk",
			effective: "on_track",
			override: "on_track",
			note: "Known slip, agreed",
			reasons: [{ kind: "failed", level: "at_risk", cardIds: ["A"] }],
		});
	});
});
