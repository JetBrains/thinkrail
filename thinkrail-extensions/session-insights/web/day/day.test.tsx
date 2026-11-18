import { describe, expect, test } from "bun:test";
import type { DaySession, DayTimelineResult, Figure } from "@thinkrail/pi-session-insights/core";
import { TooltipProvider } from "@thinkrail/ui/tooltip";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SOURCES } from "../fixtures.test";
import { neighbours } from "./api";
import { DayStrip, dayTitle } from "./DayView";
import { dayScale, dayX, hitDay, ROW_PX, WARM_ROW_PX } from "./layout";

const html = (node: ReactNode) => renderToStaticMarkup(<TooltipProvider>{node}</TooltipProvider>);
const HOUR = 3_600_000;
const START = new Date(2026, 10, 3).getTime();
const at = (hour: number) => START + hour * HOUR;
const counted = (value: number): Figure => ({ value, origin: "counted" });

function session(
	id: string,
	from: number,
	to: number,
	extra: Partial<DaySession> = {},
): DaySession {
	return {
		sessionId: id,
		title: `Session ${id}`,
		firstPrompt: null,
		projectId: "p1",
		workspaceName: "main",
		live: false,
		start: from,
		end: to,
		continues: false,
		turns: [{ id: `${id}-t1`, n: 1, trigger: "prompt", t0: from, t1: to }],
		ticks: [{ t: from, family: "execution", n: 3, errors: 1 }],
		warm: [{ t0: from, t1: to + 300_000 }],
		cacheMisses: { value: 0, origin: "approximated" },
		misses: [],
		userWaits: [],
		llmCalls: counted(4),
		toolCalls: counted(3),
		toolErrors: counted(1),
		tokens: {
			value: { input: 1, output: 1, cacheRead: 1, cacheWrite: 1, total: 4_000 },
			origin: "recorded",
		},
		cost: { value: 0.5, origin: "recorded" },
		subagents: counted(2),
		...extra,
	};
}

const DAY: DayTimelineResult = {
	apiVersion: 10,
	state: { phase: "ready", indexed: 2, total: 2 },
	day: "2026-11-03",
	days: ["2026-10-30", "2026-11-03", "2026-11-05"],
	timeZone: "Europe/Amsterdam",
	start: START,
	end: at(24),
	hours: Array.from({ length: 25 }, (_, hour) => ({ t: at(hour), hour: hour % 24 })),
	gaps: [
		{ t0: at(0), t1: at(9) },
		{ t0: at(11), t1: at(24) },
	],
	warmCount: [
		{ t: at(9), count: 1 },
		{ t: at(9.5), count: 2 },
		{ t: at(10.2), count: 0 },
	],
	totals: null,
	cacheTtlMs: 300_000,
	sessions: [
		session("a", at(9), at(10)),
		session("b", at(9.5), at(10.1), { continues: true, cost: { value: 0, origin: "notRecorded" } }),
	],
	sources: SOURCES,
};

describe("the day view", () => {
	test("steps between the days that have sessions", () => {
		expect(neighbours(DAY.days, "2026-11-03")).toEqual({
			previous: "2026-10-30",
			next: "2026-11-05",
		});
		expect(neighbours(DAY.days, "2026-10-30")).toEqual({ previous: null, next: "2026-11-03" });
		expect(neighbours(DAY.days, null)).toEqual({ previous: null, next: null });
	});

	test("compresses the empty hours into narrow breaks", () => {
		const scale = dayScale(DAY);
		if (!scale) throw new Error("no scale");
		expect(scale.breaks).toHaveLength(2);
		const width = 1000;
		const busy = dayX(scale, width, at(11)) - dayX(scale, width, at(9));
		expect(busy).toBeGreaterThan(width * 0.8);
		expect(dayScale({ ...DAY, start: null, end: null })).toBeNull();
	});

	test("hit-tests the warm-cache row and a session row's turn", () => {
		const scale = dayScale(DAY);
		if (!scale) throw new Error("no scale");
		const width = 1000;
		const x = dayX(scale, width, at(9.75));
		expect(hitDay(DAY, scale, width, x, WARM_ROW_PX / 2)).toMatchObject({ kind: "warm", count: 2 });
		const row = hitDay(DAY, scale, width, x, WARM_ROW_PX + ROW_PX + 10);
		expect(row).toMatchObject({ kind: "row", row: 1, session: { sessionId: "b" }, turn: { n: 1 } });
		const outside = hitDay(DAY, scale, width, dayX(scale, width, at(10.6)), WARM_ROW_PX + 5);
		expect(outside).toMatchObject({ kind: "row", row: 0, turn: null });
		expect(hitDay(DAY, scale, width, x, WARM_ROW_PX + 5 * ROW_PX)).toBeNull();
	});

	test("lists one row per session with its time range, turns, subagents and spend", () => {
		const markup = html(<DayStrip day={DAY} onOpen={() => {}} />);
		const rows = [...markup.matchAll(/data-testid="day-row" data-session-id="([a-z]+)"/g)].map(
			(match) => match[1],
		);
		expect(rows).toEqual(["a", "b"]);
		expect(markup).toContain("Session a");
		expect(markup).toContain("1 turn");
		expect(markup).toContain("$0.50");
		expect(markup).toContain("4K tokens");
		expect(markup).toContain("3 calls");
		expect(markup).toContain('data-testid="day-canvas"');
		expect(markup).toContain("Warm caches at once");
	});

	test("titles the day in the reader's locale", () => {
		expect(dayTitle("en-US", "2026-11-03")).toBe("November 3, 2026");
	});
});
