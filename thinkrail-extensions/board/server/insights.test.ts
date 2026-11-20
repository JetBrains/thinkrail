import { describe, expect, test } from "bun:test";
import { initiativeActivity } from "./activity";
import { DAY_MS, WEEK_MS, weekStart } from "./days";
import { insights, MIN_CYCLE_SAMPLES, percentile } from "./insights";
import type { Category, Transition } from "./model";

const NOW = Date.parse("2026-11-18T12:00:00Z");
const MONDAY = weekStart(NOW);

function move(
	cardId: string,
	from: Category | null,
	to: Category | null,
	at: number,
	reason = "seeded",
): Transition {
	return {
		cardId,
		from: from ? { category: from, column: from } : null,
		to: to ? { category: to, column: to } : null,
		at,
		actor: "automation",
		reason,
	};
}

/** A card created in Backlog, started and completed after `cycle` days, done `doneAgo` days before now. */
function flowed(cardId: string, doneAgo: number, cycle: number): Transition[] {
	const done = NOW - doneAgo * DAY_MS;
	const start = done - cycle * DAY_MS;
	return [
		move(cardId, null, "backlog", start - DAY_MS),
		move(cardId, "backlog", "started", start),
		move(cardId, "started", "review", done - DAY_MS / 2),
		move(cardId, "review", "completed", done),
	];
}

describe("insights", () => {
	test("percentiles are nearest-rank over the sorted values", () => {
		expect(percentile([], 0.5)).toBeNull();
		expect(percentile([3], 0.85)).toBe(3);
		expect(percentile([5, 1, 4, 2, 3], 0.5)).toBe(3);
		expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.85)).toBe(9);
	});

	test("an empty log answers an empty window with every chart's not-enough-data state", () => {
		const result = insights({ transitions: [], cards: [], now: NOW, weeks: 4 });
		expect(result.empty).toBe(true);
		expect(result.from).toBe(MONDAY - 3 * WEEK_MS);
		expect(result.weeks).toBe(4);
		expect(result.days).toHaveLength(3 * 7 + 3);
		expect(result.days.every((day) => day.wip === 0)).toBe(true);
		expect(result.throughput.map((week) => week.cards)).toEqual([0, 0, 0, 0]);
		expect(result.throughput.at(-1)?.partial).toBe(true);
		expect(result.cycleTimes).toEqual([]);
		expect(result.cycle).toEqual({ p50: null, p85: null });
		expect(result.sle).toBeNull();
		expect(result.aging).toEqual([]);
		expect(result.time).toEqual({ agent: 0, waiting: 0, review: 0 });
		expect(insights({ transitions: [], cards: [], now: NOW, weeks: 400 }).weeks).toBe(52);
		expect(insights({ transitions: [], cards: [], now: NOW, weeks: 0 }).weeks).toBe(1);
	});

	test("throughput counts completions per week, cycle times give the percentiles and the SLE", () => {
		const transitions = [
			...flowed("TR-1", 1, 2),
			...flowed("TR-2", 2, 4),
			...flowed("TR-3", 9, 6),
			...flowed("TR-4", 10, 8),
			...flowed("TR-5", 200, 1),
		];
		const result = insights({ transitions, cards: [], now: NOW, weeks: 3 });
		expect(result.empty).toBe(false);
		expect(result.throughput.map((week) => week.cards)).toEqual([1, 1, 2]);
		expect(result.cycleTimes.map((entry) => [entry.cardId, entry.days])).toEqual([
			["TR-4", 8],
			["TR-3", 6],
			["TR-2", 4],
			["TR-1", 2],
		]);
		expect(result.cycle).toEqual({ p50: 4, p85: 8 });
		expect(result.sle).toBe(8);
		const few = insights({ transitions: flowed("TR-1", 1, 2), cards: [], now: NOW, weeks: 3 });
		expect(few.cycleTimes).toHaveLength(1);
		expect(MIN_CYCLE_SAMPLES).toBe(3);
		expect(few.cycle).toEqual({ p50: null, p85: null });
	});

	test("WIP and the cumulative flow replay the log to each day's end", () => {
		const day = (offset: number) => MONDAY + offset * DAY_MS;
		const transitions = [
			move("TR-1", null, "backlog", day(0) + 1_000),
			move("TR-2", null, "unstarted", day(0) + 2_000),
			move("TR-1", "backlog", "started", day(1) + 1_000),
			move("TR-2", "unstarted", "started", day(1) + 2_000),
			move("TR-1", "started", "review", day(2) + 1_000),
			move("TR-2", "started", "started", day(2) + 3_000),
			move("TR-1", "review", "completed", NOW - 1_000),
			move("TR-2", "started", null, NOW - 500),
		];
		const result = insights({ transitions, cards: [], now: NOW, weeks: 1 });
		expect(result.days.map((entry) => entry.day)).toEqual([day(0), day(1), day(2)]);
		expect(result.days.map((entry) => entry.wip)).toEqual([0, 2, 0]);
		expect(result.days[0]?.flow).toEqual({
			completed: 0,
			review: 0,
			started: 0,
			unstarted: 1,
			backlog: 1,
		});
		expect(result.days[1]?.flow).toMatchObject({ started: 2, backlog: 0, unstarted: 0 });
		expect(result.days[2]?.flow).toMatchObject({ completed: 1, started: 0, review: 0 });
	});

	test("in-progress time splits into agent work, the open waits for the human and review", () => {
		const start = NOW - 3 * DAY_MS;
		const transitions = [
			move("TR-1", null, "backlog", start - DAY_MS),
			move("TR-1", "backlog", "started", start),
			move("TR-2", null, "backlog", start - DAY_MS),
			move("TR-2", "backlog", "started", start),
			move("TR-2", "started", "review", NOW - DAY_MS),
		];
		const result = insights({
			transitions,
			cards: [
				{ id: "TR-1", category: "started", waitingSince: NOW - DAY_MS },
				{ id: "TR-2", category: "review" },
			],
			now: NOW,
			weeks: 2,
		});
		expect(result.time).toEqual({ agent: 4 * DAY_MS, waiting: DAY_MS, review: DAY_MS });
		expect(result.aging).toEqual([
			{ cardId: "TR-1", category: "started", days: 3 },
			{ cardId: "TR-2", category: "review", days: 3 },
		]);
		const clipped = insights({ transitions, cards: [], now: NOW, weeks: 1 });
		const fromMonday = NOW - Math.max(MONDAY, start);
		expect(clipped.time.agent).toBe(fromMonday + (NOW - DAY_MS - Math.max(MONDAY, start)));
	});
});

describe("initiative activity", () => {
	test("lists the window's moves, what reached each state, notes, and the cards that did not move", () => {
		const since = NOW - 7 * DAY_MS;
		const cards = [
			{
				id: "TR-1",
				category: "completed" as const,
				attempts: [
					{
						workspaceId: "w1",
						sessionId: "s1",
						workflow: "implement" as const,
						startedAt: since,
						notes: [
							{ text: "old", at: since - DAY_MS },
							{ text: "tests pass", at: NOW - DAY_MS },
						],
					},
				],
			},
			{ id: "TR-2", category: "started" as const, attempts: [] },
			{ id: "TR-3", category: "backlog" as const, attempts: [] },
		];
		const transitions = [
			move("TR-1", null, "backlog", since - 3 * DAY_MS),
			move("TR-1", "backlog", "started", NOW - 3 * DAY_MS, "started"),
			move("TR-1", "started", "started", NOW - 2.5 * DAY_MS, "re-ranked"),
			move("TR-1", "started", "completed", NOW - 2 * DAY_MS, "PR merged"),
			move("TR-2", null, "backlog", since - 9 * DAY_MS),
			move("TR-2", "backlog", "started", since - 8 * DAY_MS),
			move("TR-3", null, "backlog", NOW - DAY_MS),
			move("TR-9", null, "backlog", NOW - DAY_MS),
		];
		const activity = initiativeActivity(cards, transitions, since, NOW);
		expect(activity.completed).toEqual(["TR-1"]);
		expect(activity.started).toEqual(["TR-1"]);
		expect(activity.filed).toEqual(["TR-3"]);
		expect(activity.review).toEqual([]);
		expect(activity.moves.map((entry) => `${entry.cardId}:${entry.from}>${entry.to}`)).toEqual([
			"TR-1:backlog>started",
			"TR-1:started>completed",
			"TR-3:null>backlog",
		]);
		expect(activity.notes).toEqual([{ cardId: "TR-1", text: "tests pass", at: NOW - DAY_MS }]);
		expect(activity.still).toEqual([
			{ cardId: "TR-2", category: "started", since: since - 8 * DAY_MS },
		]);
	});
});
