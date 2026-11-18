import { afterAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { tempDir, writeSession } from "../test/builders.ts";
import { type Call, ed, gr, rd, sessionOf, sh } from "../test/calls.ts";
import { statsOver } from "../test/stats.ts";
import { buildStatsSequences, parseSequencesParams } from "./sequences.ts";

const root = tempDir("sequences");
afterAll(() => rmSync(root, { recursive: true, force: true }));

const READY = { phase: "ready", indexed: 0, total: 0 } as const;
const ALL = { scope: { kind: "all" } } as const;
const day = (date: number) => new Date(2026, 10, date, 10).getTime();

async function sequencesOf(sessions: { id: string; date: number; calls: readonly Call[] }[]) {
	const files = sessions.map(({ id, date, calls }) =>
		writeSession(root, id, sessionOf(id, [{ prompt: `work ${id}`, calls }], { start: day(date) })),
	);
	const { input } = await statsOver(files);
	return buildStatsSequences(input, READY);
}

const CORPUS = [
	{
		id: "s1",
		date: 2,
		calls: [
			rd("a.ts"),
			rd("b.ts"),
			ed("a.ts"),
			sh("bun test", true),
			ed("a.ts"),
			sh("bun test"),
			sh("git status"),
		],
	},
	{
		id: "s2",
		date: 1,
		calls: [
			gr("x"),
			rd("a.ts"),
			rd("a.ts"),
			sh("bun test", true),
			rd("c.ts"),
			sh("bun run lint", true),
		],
	},
];

describe("stats.sequences", () => {
	test("params are the statistics scope", () => {
		expect(parseSequencesParams(ALL)).toEqual(ALL);
		expect(() => parseSequencesParams({ scope: { kind: "nope" } })).toThrow(
			"Invalid stats.sequences params",
		);
	});

	test("counts transitions between activities with row shares, loops and after-error marks", async () => {
		const result = await sequencesOf(CORPUS);
		const { sequences, sessions } = result;
		expect(sessions.map((session) => session.sessionId)).toEqual(["s1", "s2"]);
		expect(sequences.calls).toBe(13);
		expect(sequences.failed).toBe(3);
		expect(sequences.transitions).toBe(11);
		expect(sequences.sessionsWithCalls).toBe(2);
		expect(sequences.activities).toEqual(["search", "read", "edit", "test", "lint", "git"]);
		const cell = (from: string, to: string) =>
			sequences.cells.find((entry) => entry.source === from && entry.target === to);
		const loop = cell("read", "read");
		expect(loop).toMatchObject({ count: 2, afterError: 0, errorMark: false, sessions: [0, 1] });
		expect(loop?.share).toBeCloseTo(2 / 5);
		expect(loop?.top.map(({ session, count }) => ({ session, count }))).toEqual([
			{ session: 0, count: 1 },
			{ session: 1, count: 1 },
		]);
		expect(loop?.top[0]?.eventId).toMatch(/^tool:/);
		expect(cell("test", "edit")).toMatchObject({ count: 1, afterError: 1, errorMark: true });
		expect(cell("edit", "test")).toMatchObject({
			count: 2,
			share: 1,
			top: [{ session: 0, count: 2 }],
		});
		expect(cell("edit", "test")?.example?.steps.map((step) => [step.activity, step.pair])).toEqual([
			["read", false],
			["edit", true],
			["test", true],
			["edit", false],
		]);
		const read = sequences.nodes.find((node) => node.activity === "read");
		expect(read).toMatchObject({ calls: 5, failed: 0, starts: 1, ends: 0, transitions: 5 });
		expect(sequences.nodes.find((node) => node.activity === "search")).toMatchObject({ starts: 1 });
		expect(sequences.nodes.find((node) => node.activity === "lint")).toMatchObject({
			ends: 1,
			failed: 1,
			transitions: 0,
		});
	});

	test("frequent chains collapse repeats and count three steps", async () => {
		const { sequences } = await sequencesOf(CORPUS);
		expect(sequences.chainTotal).toBe(7);
		expect(sequences.chains[0]).toEqual({
			activities: ["search", "read", "test"],
			count: 1,
			share: 1 / 7,
		});
		expect(sequences.chains.map((chain) => chain.activities.join(">"))).toContain("edit>test>git");
	});

	test("what follows a failure: merged steps, outcomes and the failing table", async () => {
		const { sequences } = await sequencesOf(CORPUS);
		const { flow } = sequences;
		expect(flow.failures).toBe(3);
		expect(flow.sessions).toBe(2);
		expect(flow.columns.map((column) => column.map((node) => `${node.key}:${node.count}`))).toEqual(
			[
				["test:2", "lint:1"],
				["look:1", "edit:1", "end:1"],
				["recovered:1", "otherError:1", "end:1"],
				["recovered:1", "end:2"],
				["recovered:1", "ended:2"],
			],
		);
		expect(flow.links.filter((link) => link.column === 0)).toEqual([
			{ column: 0, source: "test", target: "look", count: 1 },
			{ column: 0, source: "test", target: "edit", count: 1 },
			{ column: 0, source: "lint", target: "end", count: 1 },
		]);
		expect(flow.failing).toEqual([
			{
				key: "bun test",
				tool: "bash",
				activity: "test",
				failures: 2,
				outcomes: { recovered: 1, later: 0, never: 0, ended: 1 },
				sessions: [0, 1],
			},
			{
				key: "bun run lint",
				tool: "bash",
				activity: "lint",
				failures: 1,
				outcomes: { recovered: 0, later: 0, never: 0, ended: 1 },
				sessions: [1],
			},
		]);
		expect(flow.example?.session).toBe(0);
		expect(flow.example?.steps.map((step) => [step.label, step.state])).toEqual([
			["bun test", null],
			["a.ts", "edit"],
			["bun test", "recovered"],
		]);
	});

	test("a later success and a failure never retried", async () => {
		const { sequences } = await sequencesOf([
			{
				id: "s3",
				date: 3,
				calls: [sh("bun test", true), rd("a"), rd("b"), ed("a"), rd("c"), ed("c"), sh("bun test")],
			},
			{ id: "s4", date: 4, calls: [sh("make", true), rd("a"), ed("a"), rd("b"), ed("b")] },
		]);
		expect(sequences.flow.failing.map((row) => [row.key, row.outcomes])).toEqual([
			["bun test", { recovered: 0, later: 1, never: 0, ended: 0 }],
			["make", { recovered: 0, later: 0, never: 1, ended: 0 }],
		]);
	});

	test("edge thresholds name what the map hides", async () => {
		const { sequences } = await sequencesOf([
			{
				id: "s5",
				date: 5,
				calls: [...Array.from({ length: 41 }, (_, at) => rd(`f${at}`)), ed("x")],
			},
		]);
		expect(sequences.transitions).toBe(41);
		expect(sequences.thresholds).toEqual([
			{ share: 0.01, min: 1, hiddenEdges: 0, hiddenTransitions: 0, hiddenNodes: [] },
			{ share: 0.02, min: 1, hiddenEdges: 0, hiddenTransitions: 0, hiddenNodes: [] },
			{ share: 0.05, min: 3, hiddenEdges: 1, hiddenTransitions: 1, hiddenNodes: ["edit"] },
		]);
	});

	test("deterministic output", async () => {
		const first = await sequencesOf(CORPUS);
		const second = await sequencesOf(CORPUS);
		expect(JSON.stringify(second.sequences)).toBe(JSON.stringify(first.sequences));
	});
});
