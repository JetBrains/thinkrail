import { afterAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { TranscriptBuilder, tempDir, usage, writeSession } from "../test/builders.ts";
import { CACHE_TTL_MS, DAY_TICK_MS } from "./core.ts";
import {
	buildDayTimeline,
	DayRowCache,
	type DayTimelineInput,
	dayHours,
	dayWindow,
	localDay,
	parseDayTimelineParams,
} from "./day.ts";
import { SessionIndex } from "./sessionIndex.ts";
import { TraceStore } from "./traceStore.ts";

const root = tempDir("day");
afterAll(() => rmSync(root, { recursive: true, force: true }));

const at = (hour: number, minute = 0) => new Date(2026, 10, 3, hour, minute).getTime();

function session(id: string, start: number, cwd = "/work/a") {
	const builder = new TranscriptBuilder({ id, start, cwd });
	builder.user(`work on ${id}`);
	builder.assistant({
		toolCalls: [
			{ id: `${id}-r`, name: "read", arguments: { path: "a.ts" } },
			{ id: `${id}-b`, name: "bash", arguments: { command: "bun test" } },
		],
		usage: { ...usage(5000, 0.1), cacheRead: 10 },
		durationMs: 2000,
	});
	builder.toolResult({ toolCallId: `${id}-r`, toolName: "read", durationMs: 500 });
	builder.toolResult({ toolCallId: `${id}-b`, toolName: "bash", isError: true, durationMs: 500 });
	builder.assistant({
		text: "done",
		usage: { ...usage(6000, 0.2), cacheRead: 9000 },
		durationMs: 1000,
	});
	return builder;
}

async function setup(files: string[]) {
	const index = new SessionIndex({
		sessionFiles: async () => files,
		childTranscriptDirs: async () => [],
	});
	const state = await index.ensureFresh(10_000);
	const traces = new TraceStore({ sliceMs: 1000 });
	const rows = new DayRowCache();
	const input = (projectOnly: boolean): DayTimelineInput => ({
		index,
		projects: [{ id: "p1", name: "Alpha", kind: "repository" }],
		place: (cwd) =>
			cwd === "/work/a"
				? { projectId: "p1", workspaceId: "w1", workspaceName: "main", workspace: "open" }
				: projectOnly
					? null
					: { projectId: null, workspaceId: null, workspaceName: null, workspace: "none" },
		status: () => ({ live: false, outcome: null }),
		rows,
		trace: (file) => traces.trace(file),
	});
	return { state, input };
}

describe("day windows", () => {
	test("cut days at local midnight and validate dates", () => {
		expect(localDay(at(23, 59))).toBe("2026-11-03");
		expect(dayWindow("2026-11-03")).toEqual({ t0: at(0), t1: new Date(2026, 10, 4).getTime() });
		expect(dayWindow("2026-02-30")).toBeNull();
		expect(dayWindow("26-11-03")).toBeNull();
		const window = dayWindow("2026-11-03");
		if (!window) throw new Error("no window");
		const hours = dayHours(window);
		expect(hours[0]).toEqual({ t: at(0), hour: 0 });
		expect(hours.at(-1)?.t).toBe(window.t1);
	});

	test("params take a scope and an optional valid day", () => {
		expect(parseDayTimelineParams({ scope: { kind: "all" } })).toEqual({ scope: { kind: "all" } });
		expect(parseDayTimelineParams({ scope: { kind: "all" }, day: "2026-11-03" })).toMatchObject({
			day: "2026-11-03",
		});
		expect(() => parseDayTimelineParams({ scope: { kind: "all" }, day: "yesterday" })).toThrow();
		expect(() => parseDayTimelineParams({ day: "2026-11-03" })).toThrow();
	});
});

describe("the day timeline", () => {
	test("puts the day's sessions on one strip with ticks, warm caches, misses and empty hours", async () => {
		const files = [
			writeSession(root, "a", session("morning", at(9))),
			writeSession(root, "b", session("overlap", at(9, 2))),
			writeSession(root, "c", session("evening", at(18))),
			writeSession(root, "d", session("other-day", new Date(2026, 10, 2, 12).getTime())),
			writeSession(root, "e", session("elsewhere", at(10), "/elsewhere")),
		];
		const { input, state } = await setup(files);
		const result = await buildDayTimeline(input(true), state, {
			scope: { kind: "project", projectId: "p1" },
		});
		expect(result.day).toBe("2026-11-03");
		expect(result.days).toEqual(["2026-11-02", "2026-11-03"]);
		expect(result.sessions.map((row) => row.sessionId)).toEqual(["morning", "overlap", "evening"]);
		const [morning] = result.sessions;
		expect(morning?.turns).toHaveLength(1);
		expect(morning?.ticks.every((tick) => tick.t % DAY_TICK_MS === 0)).toBe(true);
		expect(morning?.ticks.reduce((sum, tick) => sum + tick.n, 0)).toBe(2);
		expect(morning?.ticks.reduce((sum, tick) => sum + tick.errors, 0)).toBe(1);
		expect(morning?.misses).toEqual([]);
		expect(morning?.cacheMisses).toEqual({ value: 0, origin: "approximated" });
		expect(morning?.warm).toHaveLength(1);
		expect((morning?.warm[0]?.t1 ?? 0) - (morning?.warm[0]?.t0 ?? 0)).toBeGreaterThan(CACHE_TTL_MS);
		expect(Math.max(...result.warmCount.map((point) => point.count))).toBe(2);
		expect(result.warmCount.at(-1)?.count).toBe(0);
		expect(result.gaps.some((gap) => gap.t0 <= at(12) && gap.t1 >= at(13))).toBe(true);
		expect(result.gaps.some((gap) => gap.t0 <= at(9) && gap.t1 > at(9))).toBe(false);
		expect(result.totals?.toolErrors).toEqual({ value: 3, origin: "counted" });
		expect(result.totals?.llmCalls).toEqual({ value: 6, origin: "counted" });
		expect(result.totals?.cacheMisses.origin).toBe("approximated");
		expect(result.timeZone.length).toBeGreaterThan(0);

		const day = input(false);
		const other = await buildDayTimeline(day, state, { scope: { kind: "all" }, day: "2026-11-02" });
		expect(other.sessions.map((row) => row.sessionId)).toEqual(["other-day"]);
		const all = await buildDayTimeline(day, state, { scope: { kind: "all" } });
		expect(all.sessions.map((row) => row.sessionId)).toEqual([
			"morning",
			"overlap",
			"elsewhere",
			"evening",
		]);
		expect(JSON.stringify(await buildDayTimeline(day, state, { scope: { kind: "all" } }))).toBe(
			JSON.stringify(all),
		);
	});

	test("a day without sessions is empty, and a session running past midnight is clipped and flagged", async () => {
		const late = new TranscriptBuilder({ id: "late", start: at(23, 50), cwd: "/work/a" });
		late.user("long job");
		late.assistant({ text: "working", durationMs: 1000 });
		late.advance(30 * 60_000);
		late.user("still there?");
		late.assistant({ text: "yes", durationMs: 1000 });
		const { input, state } = await setup([writeSession(root, "late", late)]);
		const day = input(false);
		const result = await buildDayTimeline(day, state, {
			scope: { kind: "all" },
			day: "2026-11-03",
		});
		const [row] = result.sessions;
		expect(row?.continues).toBe(true);
		expect(row?.turns.every((turn) => turn.t1 <= (result.end ?? 0))).toBe(true);
		const none = await buildDayTimeline(day, state, { scope: { kind: "all" }, day: "2026-11-05" });
		expect(none).toMatchObject({ sessions: [], totals: null, gaps: [], day: "2026-11-05" });
	});
});
