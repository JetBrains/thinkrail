import { describe, expect, test } from "bun:test";
import { DAY_MS, dayOfIso, isIsoDate, isoOfDay, today, weekStart } from "./days";
import type { Category, Transition } from "./model";
import { completions, cycleTimes, MIN_HISTORY_WEEKS, starts, throughput } from "./throughput";

const noon = (iso: string) => Date.parse(`${iso}T12:00:00Z`);

function move(
	cardId: string,
	from: Category | null,
	to: Category | null,
	when: number,
): Transition {
	return {
		cardId,
		from: from ? { category: from, column: from } : null,
		to: to ? { category: to, column: to } : null,
		at: when,
		actor: "automation",
		reason: "test",
	};
}

describe("days", () => {
	test("read and write ISO dates as UTC day numbers", () => {
		expect(isIsoDate("2026-02-28")).toBe(true);
		for (const bad of ["2026-02-30", "2026-2-1", "26-01-01", "2026-01-01T00:00", ""])
			expect(isIsoDate(bad)).toBe(false);
		expect(dayOfIso("1970-01-02")).toBe(1);
		expect(isoOfDay(dayOfIso("2026-11-18") + 0.9)).toBe("2026-11-18");
		expect(today(noon("2026-11-18"))).toBe(dayOfIso("2026-11-18"));
	});

	test("a week starts on Monday 00:00 UTC", () => {
		const monday = Date.parse("2026-01-05T00:00:00Z");
		expect(weekStart(noon("2026-01-05"))).toBe(monday);
		expect(weekStart(noon("2026-01-11"))).toBe(monday);
		expect(weekStart(noon("2026-01-12"))).toBe(monday + 7 * DAY_MS);
	});
});

describe("throughput", () => {
	test("a card is completed at its last move into completed, unless it left again; a deletion keeps it", () => {
		const done = completions([
			move("A", "review", "completed", 10),
			move("A", "completed", "completed", 12),
			move("B", "review", "completed", 20),
			move("B", "completed", "review", 25),
			move("C", "review", "completed", 30),
			move("C", "completed", "review", 31),
			move("C", "review", "completed", 40),
			move("D", "review", "completed", 50),
			move("D", "completed", null, 55),
		]);
		expect(Object.fromEntries(done)).toEqual({ A: 10, C: 40, D: 50 });
	});

	test("starts are each card's first and latest move into started from elsewhere", () => {
		const spans = starts([
			move("A", "backlog", "started", 10),
			move("A", "started", "started", 12),
			move("A", "started", "review", 20),
			move("A", "review", "started", 30),
			move("B", "review", "completed", 5),
		]);
		expect(Object.fromEntries(spans)).toEqual({ A: { first: 10, last: 30 } });
	});

	test("cycle time runs from the first start to the completion", () => {
		const times = cycleTimes([
			move("A", "backlog", "started", 10),
			move("A", "started", "review", 20),
			move("A", "review", "started", 30),
			move("A", "started", "completed", 45),
			move("B", "backlog", "completed", 50),
			move("C", "backlog", "started", 60),
		]);
		expect(Object.fromEntries(times)).toEqual({ A: 35 });
	});

	test("weighs each whole week's completions in size points, the current week left out", () => {
		const points: Record<string, number> = { A: 1, B: 4, C: 2 };
		const flow = throughput(
			[
				move("X", null, "backlog", noon("2026-01-06")),
				move("A", "review", "completed", noon("2026-01-07")),
				move("B", "review", "completed", noon("2026-01-08")),
				move("C", "review", "completed", noon("2026-01-21")),
				move("D", "review", "completed", noon("2026-01-27")),
			],
			(id) => points[id] ?? 2,
			noon("2026-01-28"),
		);
		expect(flow.weeks).toEqual([
			{ start: Date.parse("2026-01-05T00:00:00Z"), cards: 2, points: 5 },
			{ start: Date.parse("2026-01-12T00:00:00Z"), cards: 0, points: 0 },
			{ start: Date.parse("2026-01-19T00:00:00Z"), cards: 1, points: 2 },
		]);
		expect(flow.completed).toBe(3);
		expect(flow.insufficientData).toBe(false);
	});

	test(`has not enough data below ${MIN_HISTORY_WEEKS} whole weeks or without a completion`, () => {
		const short = throughput(
			[move("A", "review", "completed", noon("2026-01-13"))],
			() => 1,
			noon("2026-01-28"),
		);
		expect(short.weeks).toHaveLength(2);
		expect(short.insufficientData).toBe(true);
		const idle = throughput(
			[
				move("A", null, "backlog", noon("2026-01-01")),
				move("A", "backlog", "started", noon("2026-01-02")),
			],
			() => 1,
			noon("2026-01-28"),
		);
		expect(idle.weeks.length).toBeGreaterThanOrEqual(MIN_HISTORY_WEEKS);
		expect(idle).toMatchObject({ completed: 0, insufficientData: true });
		expect(throughput([], () => 1, noon("2026-01-28"))).toEqual({
			weeks: [],
			completed: 0,
			insufficientData: true,
		});
	});
});
