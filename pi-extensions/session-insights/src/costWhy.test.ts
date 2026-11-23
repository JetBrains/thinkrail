import { afterAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { cached, TranscriptBuilder, tempDir, writeSession } from "../test/builders.ts";
import { LARGE_TEST_MS, withinBudget } from "../test/perf.ts";
import { buildSessionCost } from "./costWhy.ts";
import { TraceStore } from "./traceStore.ts";

const root = tempDir("cost");
afterAll(() => rmSync(root, { recursive: true, force: true }));

const T0 = Date.parse("2026-11-03T09:00:00.000Z");

async function traceOf(name: string, builder: TranscriptBuilder) {
	const trace = await new TraceStore({ sliceMs: 1000 }).trace(writeSession(root, name, builder));
	if (!trace) throw new Error("no trace");
	return trace;
}

/** A call reading all but 1,000 tokens of its context from cache. */
function warm(context: number, cost: number) {
	return cached({ input: 1_000, cacheRead: context - 1_000 }, cost);
}

function todo(id: string, title: string, status: string) {
	return { id, title, status, origin: "agent" };
}

function update(
	builder: TranscriptBuilder,
	id: string,
	item: ReturnType<typeof todo>,
	context: number,
) {
	builder.assistant({
		toolCalls: [{ id, name: "todo_update", arguments: { id: item.id, status: item.status } }],
		usage: warm(context, 0.001),
	});
	builder.toolResult({
		toolCallId: id,
		toolName: "todo_update",
		details: { todo: item, paused: [] },
	});
}

function planned() {
	const builder = new TranscriptBuilder({ id: "planned", start: T0 });
	const ids: Record<string, string> = {};
	builder.user("build the parser and write the docs");
	builder.assistant({
		toolCalls: [{ id: "w", name: "todo_write", arguments: {} }],
		usage: warm(60_000, 0.001),
	});
	builder.toolResult({
		toolCallId: "w",
		toolName: "todo_write",
		details: {
			plan: {
				todos: [
					todo("t_a", "Build the parser", "pending"),
					todo("t_b", "Write the docs", "pending"),
				],
				groups: [],
			},
		},
	});
	update(builder, "u1", todo("t_a", "Build the parser", "in_progress"), 60_000);
	builder.assistant({
		toolCalls: [{ id: "e1", name: "edit", arguments: { path: "src/parser.ts" } }],
		usage: warm(61_000, 0.1),
	});
	builder.toolResult({ toolCallId: "e1", toolName: "edit" });
	builder.assistant({ text: "Parsed.", usage: warm(62_000, 0.1) });
	update(builder, "u2", todo("t_a", "Build the parser", "done"), 62_000);
	update(builder, "u3", todo("t_b", "Write the docs", "in_progress"), 62_000);
	ids.big = builder.assistant({
		toolCalls: [{ id: "b1", name: "bash", arguments: { command: "bun run docs" } }],
		usage: warm(90_000, 1.0),
	});
	builder.toolResult({
		toolCallId: "b1",
		toolName: "bash",
		text: "failed\nCommand exited with code 1",
		isError: true,
	});
	ids.bigger = builder.assistant({ text: "Docs.", usage: warm(95_000, 1.0) });
	ids.compaction = builder.compaction(cached({ input: 5_000 }, 0.05));
	ids.after = builder.assistant({
		text: "Shorter now.",
		usage: cached({ input: 1_000, cacheWrite: 19_000 }, 0.5),
	});
	return { builder, ids };
}

describe("why expensive", () => {
	test("moments are consecutive calls of one plan step, split by a compaction, ranked by recorded $", async () => {
		const { builder, ids } = planned();
		const cost = await buildSessionCost(await traceOf("planned", builder), {
			contextWindow: async () => 100_000,
		});
		expect(cost.headline).toBe("cost");
		expect(cost.total.value).toBeCloseTo(2.754, 6);
		expect(cost.total.origin).toBe("recorded");
		expect(cost.summaries.value).toBeCloseTo(0.05, 6);
		expect(cost.calls).toHaveLength(9);
		expect(cost.calls[0]).toMatchObject({ n: 1, cost: 0.001, context: 60_000 });
		const [first, second, third] = cost.moments;
		expect(first).toMatchObject({
			rank: 1,
			stepTitle: "Write the docs",
			stepN: 2,
			turnN: 1,
			phase: "beforeCompaction",
			llmCalls: 2,
			toolCalls: 1,
			errors: 1,
			contextMin: 90_000,
			contextMax: 95_000,
			tools: [{ name: "bun run docs", n: 1 }],
			topCall: { id: ids.big, n: 7, cost: 1 },
		});
		expect(first?.cost.value).toBeCloseTo(2, 6);
		expect(first?.share).toBeCloseTo(2 / 2.754, 6);
		expect(second).toMatchObject({
			rank: 2,
			stepTitle: "Write the docs",
			phase: "afterCompaction",
		});
		expect(third).toMatchObject({
			rank: 3,
			stepTitle: "Build the parser",
			phase: null,
			llmCalls: 3,
		});
		expect(cost.compactions).toEqual([
			{ id: ids.compaction ?? "", t: expect.any(Number), after: ids.after ?? null },
		]);
	});

	test("the diagnosis is filled from measured figures only", async () => {
		const { builder } = planned();
		const { diagnosis } = await buildSessionCost(await traceOf("diagnosis", builder), {
			contextWindow: async () => 100_000,
		});
		expect(diagnosis.kind).toBe("longContext");
		expect(diagnosis.calls).toBe(9);
		expect(diagnosis.peakContext).toBe(95_000);
		expect(diagnosis.averageContext).toBe(Math.round(572_000 / 9));
		expect(diagnosis.cacheReadShare).toBeGreaterThan(0.8);
		expect(diagnosis.focus).toMatchObject({
			kind: "steps",
			items: [
				{ n: 2, title: "Write the docs" },
				{ n: 1, title: "Build the parser" },
			],
			peakContext: 95_000,
		});
		expect(diagnosis.highContext).toEqual({
			calls: 2,
			value: 2,
			models: [{ model: "anthropic/claude-test", threshold: 80_000, calls: 2 }],
		});
		expect(diagnosis.compaction?.afterCall).toBeCloseTo(0.5, 6);
		expect(diagnosis.compaction?.afterContext).toBe(20_000);
		expect(diagnosis.rewrites).toBeNull();
	});

	test("call-price figures are true medians: the mean of the middle two for an even count", async () => {
		const even = new TranscriptBuilder({ id: "median-even", start: T0 });
		even.user("go");
		for (const [input, cost] of [
			[40_000, 0.4],
			[10_000, 0.1],
			[100_000, 1.0],
			[20_000, 0.2],
		] as const)
			even.assistant({ text: "a", usage: cached({ input }, cost) });
		const evenCost = await buildSessionCost(await traceOf("median-even", even));
		expect(evenCost.diagnosis.medianCall).toBeCloseTo(0.3, 9);
		expect(evenCost.diagnosis.compaction).toBeNull();

		const around = new TranscriptBuilder({ id: "median-compaction", start: T0 });
		around.user("go");
		for (const [input, cost] of [
			[10_000, 0.1],
			[100_000, 1.0],
			[20_000, 0.2],
			[40_000, 0.4],
		] as const)
			around.assistant({ text: "before", usage: cached({ input }, cost) });
		around.compaction();
		for (const [input, cost] of [
			[60_000, 2.0],
			[5_000, 0.3],
			[7_000, 0.5],
		] as const)
			around.assistant({ text: "after", usage: cached({ input }, cost) });
		const { diagnosis } = await buildSessionCost(await traceOf("median-compaction", around));
		expect(diagnosis.medianCall).toBeCloseTo(0.4, 9);
		expect(diagnosis.compaction?.beforeCall).toBeCloseTo(0.3, 9);
		expect(diagnosis.compaction?.beforeContext).toBe(30_000);
		expect(diagnosis.compaction?.afterCall).toBeCloseTo(0.5, 9);
		expect(diagnosis.compaction?.afterContext).toBe(7_000);
	});

	test("a call is high-context against its own model's window, never the smallest one of the session", async () => {
		const builder = new TranscriptBuilder({ id: "two-windows", start: T0 });
		builder.user("go");
		const small = (input: number, cost: number) =>
			builder.assistant({ model: "small-200k", text: "s", usage: cached({ input }, cost) });
		const large = (input: number, cost: number) =>
			builder.assistant({ model: "large-1m", text: "l", usage: cached({ input }, cost) });
		small(100_000, 0.1);
		small(180_000, 0.2);
		builder.modelChange("anthropic", "large-1m");
		large(300_000, 0.4);
		large(500_000, 0.8);
		large(850_000, 1.6);
		builder.modelChange("faux", "unknown");
		builder.assistant({
			provider: "faux",
			model: "unknown",
			text: "u",
			usage: cached({ input: 120_000 }, 3.2),
		});
		const windows: Record<string, number> = { "small-200k": 200_000, "large-1m": 1_000_000 };
		const { diagnosis } = await buildSessionCost(await traceOf("two-windows", builder), {
			contextWindow: async (_provider, model) => windows[model] ?? null,
		});
		expect(diagnosis.highContext).toEqual({
			calls: 2,
			value: 1.8,
			models: [
				{ model: "anthropic/large-1m", threshold: 800_000, calls: 1 },
				{ model: "anthropic/small-200k", threshold: 160_000, calls: 1 },
			],
		});
	});

	test("cache rewrites lead the diagnosis; a spike without a visible cause says so", async () => {
		const builder = new TranscriptBuilder({ id: "spikes", start: T0 });
		builder.user("go");
		builder.assistant({ text: "a", usage: warm(40_000, 0.1) });
		builder.advance(6 * 60_000);
		const paused = builder.assistant({
			text: "b",
			usage: cached({ input: 500, cacheRead: 500, cacheWrite: 39_000 }, 1.0),
		});
		const silent = builder.assistant({
			text: "c",
			usage: cached({ input: 500, cacheRead: 300, cacheWrite: 39_500 }, 1.1),
		});
		const cost = await buildSessionCost(await traceOf("spikes", builder));
		expect(cost.diagnosis.kind).toBe("cacheRewrites");
		expect(cost.diagnosis.rewrites?.calls).toBe(2);
		expect(cost.spikes.map((spike) => [spike.id, spike.causes])).toEqual([
			[silent, []],
			[paused, ["pause"]],
		]);
		expect(cost.spikes[1]).toMatchObject({
			n: 2,
			turnN: 1,
			firstOfTurn: false,
			cacheWrite: 39_000,
		});
		expect(cost.diagnosis.highContext).toBeNull();
	});

	test("a model that records $0 ranks by tokens and says the headline is tokens", async () => {
		const builder = new TranscriptBuilder({ id: "unpriced", start: T0 });
		builder.user("one");
		builder.assistant({ provider: "claude-bridge", text: "a", usage: cached({ input: 5_000 }, 0) });
		builder.user("two");
		builder.assistant({ provider: "claude-bridge", text: "b", usage: cached({ input: 9_000 }, 0) });
		builder.user("three");
		builder.assistant({ provider: "claude-bridge", text: "c", usage: cached({ input: 1_000 }, 0) });
		const cost = await buildSessionCost(await traceOf("unpriced", builder));
		expect(cost.headline).toBe("tokens");
		expect(cost.total).toEqual({ value: 15_300, origin: "recorded" });
		expect(cost.moments.map((moment) => [moment.turnN, moment.tokens.value])).toEqual([
			[2, 9_100],
			[1, 5_100],
			[3, 1_100],
		]);
		expect(cost.moments[0]?.cost.origin).toBe("notRecorded");
		expect(cost.diagnosis.focus?.kind).toBe("turns");
	});

	test("an empty session has no diagnosis, and the same trace builds byte-identically", async () => {
		const empty = new TranscriptBuilder({ id: "empty", start: T0 });
		empty.user("hello");
		expect((await buildSessionCost(await traceOf("empty", empty))).diagnosis.kind).toBe("none");
		const trace = await traceOf("again", planned().builder);
		const first = JSON.stringify(await buildSessionCost(trace));
		expect(JSON.stringify(await buildSessionCost(trace))).toBe(first);
	});

	test(
		"a 2,400-call session's cost view builds within the summary budget and stays under 1 MB",
		async () => {
			const builder = new TranscriptBuilder({ id: "large-cost", start: T0 });
			for (let turn = 0; turn < 120; turn += 1) {
				builder.user(`turn ${turn}`);
				for (let call = 0; call < 20; call += 1)
					builder.assistant({
						text: "Working.",
						usage: warm(5_000 + turn * 100, 0.01),
						durationMs: 800,
					});
			}
			const trace = await traceOf("large-cost", builder);
			const started = performance.now();
			const cost = await buildSessionCost(trace, { contextWindow: async () => 200_000 });
			withinBudget(performance.now() - started, 500);
			expect(cost.calls).toHaveLength(2_400);
			expect(JSON.stringify(cost).length).toBeLessThan(1_000_000);
		},
		LARGE_TEST_MS,
	);
});
