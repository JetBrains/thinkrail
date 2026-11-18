import { afterAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { tempDir, writeSession } from "../test/builders.ts";
import { type Call, ed, gr, rd, sessionOf, sh } from "../test/calls.ts";
import {
	AlignmentCache,
	alignClass,
	alignmentPage,
	alignPairs,
	alignSessions,
	buildSessionsAlign,
	type PairScore,
	pairTurns,
	parseAlignParams,
} from "./align.ts";
import type { ToolEvent } from "./core.ts";
import type { CallFacts } from "./facts.ts";
import { mulberry32 } from "./stats.ts";
import { TraceStore } from "./traceStore.ts";

const root = tempDir("align");
afterAll(() => rmSync(root, { recursive: true, force: true }));

function tool(name: string, head?: string): ToolEvent {
	return {
		kind: "tool",
		id: "t",
		parent: null,
		depth: 1,
		t0: 0,
		t1: 0,
		timing: "notMeasured",
		label: "",
		tool: name,
		family: "other",
		toolCallId: "c",
		argsChars: 0,
		resultChars: 0,
		...(head ? { head } : {}),
	};
}

const facts = (skill: string | null): CallFacts => ({
	key: "",
	path: null,
	words: [],
	objects: [],
	skill,
	todo: null,
	edit: false,
	file: null,
});

/** The best total score by a full table: the reference the split alignment must reach. */
function bestScore(n: number, m: number, score: PairScore): number {
	const width = m + 1;
	const table = new Float64Array((n + 1) * width);
	for (let i = n - 1; i >= 0; i--)
		for (let j = m - 1; j >= 0; j--) {
			const s = score(i, j);
			const skip = Math.max(table[(i + 1) * width + j] ?? 0, table[i * width + j + 1] ?? 0);
			table[i * width + j] =
				s > Number.NEGATIVE_INFINITY
					? Math.max(skip, s + (table[(i + 1) * width + j + 1] ?? 0))
					: skip;
		}
	return table[0] ?? 0;
}

function randomScore(n: number, m: number, seed: number, classes = 5): PairScore {
	const random = mulberry32(seed);
	const a = Array.from({ length: n }, () => Math.floor(random() * classes));
	const b = Array.from({ length: m }, () => Math.floor(random() * classes));
	const weightA = Array.from({ length: n }, () => Math.floor(random() * 4));
	const weightB = Array.from({ length: m }, () => Math.floor(random() * 4));
	return (i, j) =>
		a[i] === b[j]
			? 1 + ((weightA[i] ?? 0) === (weightB[j] ?? 0) ? 3 : 0)
			: Number.NEGATIVE_INFINITY;
}

function totalOf(pairs: [number, number][], score: PairScore): number {
	let total = 0;
	let lastI = -1;
	let lastJ = -1;
	for (const [i, j] of pairs) {
		expect(i).toBeGreaterThan(lastI);
		expect(j).toBeGreaterThan(lastJ);
		lastI = i;
		lastJ = j;
		total += score(i, j);
	}
	return total;
}

describe("alignment classes", () => {
	test.each([
		[tool("read"), null, "file"],
		[tool("read"), facts("review-pr"), "skill:review-pr"],
		[tool("grep"), null, "search"],
		[tool("edit"), null, "edit"],
		[tool("bash", "git diff"), null, "git diff"],
		[tool("bash", "git worktree add"), null, "git checkout"],
		[tool("bash", "gh pr view"), null, "gh pr view"],
		[tool("bash", "bun test"), null, "bun test"],
		[tool("bash", "cat"), null, "file"],
		[tool("bash", "rg"), null, "search"],
		[tool("bash", "python3"), null, "python3"],
		[tool("ask_user_question"), null, "ask_user_question"],
	] as const)("%#: %o is %s", (event, call, klass) => {
		expect(alignClass(event, call)).toBe(klass);
	});
});

describe("the split alignment", () => {
	test("reaches the full table's best score on random inputs", async () => {
		for (const [n, m, seed] of [
			[0, 5, 1],
			[1, 7, 2],
			[7, 1, 3],
			[40, 33, 4],
			[120, 97, 5],
			[300, 280, 6],
		] as const) {
			const score = randomScore(n, m, seed);
			const pairs = await alignPairs(n, m, score);
			expect(totalOf(pairs, score)).toBe(bestScore(n, m, score));
		}
	});

	test("keeps its tables linear in size at 2,400 × 2,400 calls", async () => {
		const n = 2400;
		const score = randomScore(n, n, 9);
		const meter = { live: 0, peak: 0 };
		const first = await alignPairs(n, n, score, meter);
		expect(meter.live).toBe(0);
		expect(meter.peak).toBeLessThan(10 * (n + 1));
		expect(meter.peak).toBeLessThan((n * n) / 100);
		const second = await alignPairs(n, n, score);
		expect(second).toEqual(first);
	});
});

describe("turn pairs", () => {
	test("the first turns always, later ones by prompt similarity", () => {
		const words = (...values: number[]) => values.sort((x, y) => x - y);
		const a = [words(1, 2), words(10, 11, 12), words(20, 21), words(30, 31)];
		const b = [words(5), words(30, 31, 32), words(10, 11, 12)];
		expect(pairTurns(a, b)).toEqual([
			{ a: 0, b: 0, similarity: 0, by: "first" },
			{ a: 1, b: 2, similarity: 1, by: "prompt" },
		]);
		expect(pairTurns([], b)).toEqual([]);
	});
});

async function traceOf(id: string, turns: { prompt: string; calls: readonly Call[] }[]) {
	const file = writeSession(root, id, sessionOf(id, turns));
	const trace = await new TraceStore().trace(file);
	if (!trace) throw new Error("no trace");
	return { sessionId: id, trace };
}

describe("sessions.align", () => {
	test("params", () => {
		expect(parseAlignParams({ a: "x", b: "y" })).toEqual({ a: "x", b: "y" });
		expect(parseAlignParams({ a: "x", b: "y", cursor: 3 })).toEqual({ a: "x", b: "y", cursor: 3 });
		expect(parseAlignParams({ a: "x", b: "y", revisions: { a: "1:2", b: "3:4" } })).toEqual({
			a: "x",
			b: "y",
			revisions: { a: "1:2", b: "3:4" },
		});
		for (const bad of [
			{ a: "x" },
			{ a: "", b: "y" },
			{ a: "x", b: "y", cursor: -1 },
			{ a: "x", b: "y", revisions: { a: "1:2" } },
			{ a: "x", b: "y", revisions: "1:2" },
			"x",
		])
			expect(() => parseAlignParams(bad)).toThrow("Invalid sessions.align params");
	});

	test("aligns the same actions, the same kind of action and one-sided calls turn by turn", async () => {
		const a = await traceOf("left", [
			{
				prompt: "fix the parser bug",
				calls: [
					rd("src/parser.ts"),
					gr("parseLine"),
					sh("bun test parser.test.ts", true),
					ed("src/parser.ts"),
					sh("bun test parser.test.ts"),
				],
			},
			{ prompt: "now update the changelog entry", calls: [ed("CHANGELOG.md")] },
			{ prompt: "what should we have for lunch", calls: [sh("date")] },
		]);
		const b = await traceOf("right", [
			{
				prompt: "fix the parser bug quickly",
				calls: [
					rd("src/parser.ts"),
					sh("bun test parser.test.ts"),
					ed("src/lexer.ts"),
					sh("bun test lexer.test.ts"),
					sh("git status"),
				],
			},
			{ prompt: "update the changelog entry now", calls: [ed("CHANGELOG.md")] },
		]);
		const full = await alignSessions(a, b);
		expect(full.pairs.map((pair) => [pair.a, pair.b, pair.by])).toEqual([
			[0, 0, "first"],
			[1, 1, "prompt"],
		]);
		const label = (side: "a" | "b", index: number | null) =>
			index === null ? null : (side === "a" ? full.a : full.b).steps[index]?.label;
		expect(
			full.rows.map((row) => [row.op, label("a", row.a), label("b", row.b), row.pair]),
		).toEqual([
			["same", "src/parser.ts", "src/parser.ts", 0],
			["onlyA", "parseLine", null, 0],
			["same", "bun test parser.test.ts", "bun test parser.test.ts", 0],
			["similar", "src/parser.ts", "src/lexer.ts", 0],
			["similar", "bun test parser.test.ts", "bun test lexer.test.ts", 0],
			["onlyB", null, "git status", 0],
			["same", "CHANGELOG.md", "CHANGELOG.md", 1],
			["onlyA", "date", null, null],
		]);
		expect(full.totals).toEqual({ same: 3, similar: 2, onlyA: 2, onlyB: 1 });
		expect(full.similarity).toBeCloseTo(10 / 13);
		expect(full.a.steps[2]).toMatchObject({
			failed: true,
			activity: "test",
			klass: "bun test",
			turn: 0,
		});
		expect(full.a.side.turns.map((turn) => turn.calls)).toEqual([5, 1, 1]);
	});

	test("pages rows with the steps they name, from one cached alignment", async () => {
		const many = (count: number, make: (at: number) => Call) =>
			Array.from({ length: count }, (_, at) => make(at));
		const a = await traceOf("big-a", [{ prompt: "go", calls: many(900, (at) => rd(`a${at}.ts`)) }]);
		const b = await traceOf("big-b", [
			{ prompt: "go", calls: many(900, (at) => sh(`python3 b${at}.py`)) },
		]);
		const cache = new AlignmentCache();
		const first = await buildSessionsAlign(cache, a, b, 0);
		expect(first.found).toBe(true);
		const page = first.alignment;
		expect(page?.totalRows).toBe(1800);
		expect(page?.rows).toHaveLength(1500);
		expect(page?.next).toBe(1500);
		expect(Object.keys(page?.stepsA ?? {})).toHaveLength(900);
		expect(Object.keys(page?.stepsB ?? {})).toHaveLength(600);
		const second = await buildSessionsAlign(cache, a, b, 1500);
		expect(second.alignment?.rows).toHaveLength(300);
		expect(second.alignment?.next).toBeNull();
		expect(JSON.stringify(first).length).toBeLessThan(1_000_000);
		const full = await cache.get(a, b);
		expect(alignmentPage(full, 1500).rows).toEqual(second.alignment?.rows ?? []);
		expect(second.newerRevision).toBe(false);
		const pinned = await buildSessionsAlign(cache, { ...a, newerRevision: true }, b, 1500);
		expect(pinned.newerRevision).toBe(true);
		expect(pinned.alignment?.rows).toEqual(second.alignment?.rows ?? []);
		expect(await buildSessionsAlign(cache, a, null, 0)).toMatchObject({
			found: false,
			alignment: null,
			newerRevision: false,
		});
	});
});
