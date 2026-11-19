import { afterAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { runDetails, TranscriptBuilder, tempDir, usage, writeSession } from "../test/builders.ts";
import { LARGE_TEST_MS, withinBudget } from "../test/perf.ts";
import type { TraceEvent, TurnEvent } from "./core.ts";
import { TRACE_GAP_MIN_MS } from "./core.ts";
import { buildSessionTimeline, cacheMisses } from "./timeline.ts";
import { recordedTotals } from "./totals.ts";
import { TraceStore } from "./traceStore.ts";
import { AGENT_LATENCY_MAX_MS, idleGaps, packTracks, waitBands } from "./waits.ts";

const root = tempDir("timeline");
afterAll(() => rmSync(root, { recursive: true, force: true }));

const T0 = Date.parse("2026-11-01T10:00:00.000Z");

async function traceOf(name: string, builder: TranscriptBuilder) {
	const trace = await new TraceStore({ sliceMs: 1000 }).trace(writeSession(root, name, builder));
	if (!trace) throw new Error("no trace");
	return trace;
}

function turns(events: readonly TraceEvent[]): TurnEvent[] {
	return events.filter((event): event is TurnEvent => event.kind === "turn");
}

describe("turn segmentation", () => {
	test("a completion that wakes the idle agent starts a labelled turn; one delivered into a run does not", async () => {
		const builder = new TranscriptBuilder({ id: "wakes", start: T0 });
		builder.user("start the build in the background");
		builder.assistant({
			toolCalls: [
				{ id: "bg", name: "background_command", arguments: { command: "bun run build" } },
			],
		});
		builder.toolResult({ toolCallId: "bg", toolName: "background_command", text: "started" });
		builder.assistant({ text: "Started; I'll wait." });
		builder.advance(5 * 60_000);
		const woke = builder.customMessage(
			"background-command-completion",
			{ id: "job-1", status: "finished", delivery: "wake" },
			"Finished background command bun run build (exit 0)",
		);
		builder.assistant({ toolCalls: [{ id: "r1", name: "read", arguments: { path: "out.log" } }] });
		const appended = builder.customMessage(
			"background-command-completion",
			{ id: "job-2", status: "finished", delivery: "run" },
			"Finished another command",
		);
		builder.toolResult({ toolCallId: "r1", toolName: "read" });
		builder.assistant({ text: "The build passed." });
		builder.advance(60_000);
		const inferred = builder.customMessage(
			"subagent-completion",
			runDetails("kid-9", "completed", { tokens: 5, cost: 0.01 }),
			'Subagent "scout" (kid-9) completed',
		);
		builder.assistant({ text: "The scout is done." });
		const trace = await traceOf("wakes", builder);
		expect(turns(trace.events).map((turn) => [turn.n, turn.trigger, turn.id])).toEqual([
			[1, "prompt", expect.any(String)],
			[2, "background", woke],
			[3, "subagent", inferred],
		]);
		const second = turns(trace.events)[1];
		expect(second?.label).toBe("Finished background command bun run build (exit 0)");
		const mark = trace.events.find((event) => event.id === appended);
		expect(mark).toMatchObject({ kind: "mark", mark: "customMessage", parent: woke });
	});

	test("a completion arriving between a tool call and its follow-up without a delivery stays inside the turn", async () => {
		const builder = new TranscriptBuilder({ id: "midrun", start: T0 });
		builder.user("go");
		builder.assistant({ toolCalls: [{ id: "g", name: "grep", arguments: { pattern: "x" } }] });
		builder.toolResult({ toolCallId: "g", toolName: "grep" });
		const done = builder.customMessage("background-command-completion", { id: "j" }, "Finished");
		builder.assistant({ text: "ok" });
		const trace = await traceOf("midrun", builder);
		expect(turns(trace.events)).toHaveLength(1);
		expect(trace.events.find((event) => event.id === done)?.kind).toBe("mark");
	});

	test("a marker written long after the last call, like a restored chat's model change, does not stretch the turn", async () => {
		const builder = new TranscriptBuilder({ id: "late-mark", start: T0 });
		builder.user("hi");
		const reply = builder.assistant({ text: "hello", durationMs: 1000 });
		builder.advance(3 * 24 * 3_600_000);
		builder.modelChange("anthropic", "claude-next");
		const trace = await traceOf("late-mark", builder);
		const [turn] = turns(trace.events);
		const call = trace.events.find((event) => event.id === reply);
		expect(turn?.t1).toBe(call?.t1);
		expect(trace.meta.end).toBeGreaterThan((call?.t1 ?? 0) + 24 * 3_600_000);
		expect(trace.meta.gaps.at(-1)?.cause).toBe("idle");
	});
});

describe("who waits", () => {
	test("attributes running work and idle stretches to what ends them, and compresses long waits", async () => {
		const builder = new TranscriptBuilder({ id: "waits", start: T0 });
		builder.user("ask me something");
		builder.assistant({
			toolCalls: [{ id: "ask", name: "ask_user_question", arguments: { question: "Which?" } }],
			durationMs: 800,
		});
		builder.toolResult({
			toolCallId: "ask",
			toolName: "ask_user_question",
			text: "A",
			durationMs: 4 * 60_000,
			stepMs: 4 * 60_000,
		});
		builder.assistant({ text: "Done.", durationMs: 1000 });
		builder.advance(30 * 60_000);
		builder.user("again");
		builder.assistant({ text: "ok", durationMs: 1000 });
		const trace = await traceOf("waits", builder);
		const actors = trace.bands.map((band) => band.actor);
		expect(actors).toContain("user");
		expect(actors).toContain("model");
		const ask = trace.events.find((event) => event.kind === "tool");
		const askBand = trace.bands.find((band) => band.t0 === ask?.t0);
		expect(askBand?.actor).toBe("user");
		expect(trace.meta.gaps.map((gap) => gap.cause)).toEqual(["user", "user"]);
		expect(trace.meta.gaps.every((gap) => gap.t1 - gap.t0 >= TRACE_GAP_MIN_MS)).toBe(true);
		for (const [a, b] of trace.bands.slice(1).map((band, at) => [trace.bands[at], band]))
			expect(a?.t1).toBe(b?.t0);
	});

	test("a pause the agent resumes from on its own is the model when short, nobody when long", () => {
		const call = (id: string, t0: number, t1: number): TraceEvent => ({
			kind: "llm",
			id,
			parent: null,
			depth: 1,
			t0,
			t1,
			timing: "recorded",
			label: "",
			model: "m",
			stop: "toolUse",
			tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			cost: 0,
			replyChars: 0,
			thinking: "none",
			calls: 0,
		});
		const short = T0 + 1000 + AGENT_LATENCY_MAX_MS / 2;
		const bands = waitBands(
			[
				call("a", T0, T0 + 1000),
				call("b", short, short + 1000),
				call("c", T0 + 3_600_000, T0 + 3_601_000),
			],
			T0,
			T0 + 3_601_000,
		);
		expect(bands.map((band) => band.actor)).toEqual(["model", "idle", "model"]);
		expect(idleGaps(bands)).toEqual([{ t0: short + 1000, t1: T0 + 3_600_000, cause: "idle" }]);
	});

	test("parallel calls pack onto the first free track, deterministically", () => {
		const items = [
			{ id: "c", t0: 5, t1: 9 },
			{ id: "a", t0: 0, t1: 10 },
			{ id: "b", t0: 0, t1: 4 },
			{ id: "d", t0: 12, t1: 13 },
		];
		const packed = packTracks(items, 8);
		expect(packed.tracks).toBe(2);
		expect(Object.fromEntries(packed.of)).toEqual({ b: 0, a: 1, c: 0, d: 0 });
		expect(Object.fromEntries(packTracks([...items].reverse(), 8).of)).toEqual(
			Object.fromEntries(packed.of),
		);
		expect(packTracks(items, 1).tracks).toBe(1);
	});
});

function workSession(id: string) {
	const builder = new TranscriptBuilder({ id, start: T0 });
	builder.user("fix it");
	builder.assistant({
		toolCalls: [
			{ id: "r1", name: "read", arguments: { path: "a.ts" } },
			{ id: "r2", name: "read", arguments: { path: "b.ts" } },
			{ id: "sub", name: "Agent", arguments: { subagent_type: "scout", task: "map" } },
		],
		usage: { ...usage(5000, 0.1), cacheRead: 10 },
		durationMs: 2000,
	});
	builder.toolResult({ toolCallId: "r1", toolName: "read", durationMs: 900 });
	builder.toolResult({ toolCallId: "r2", toolName: "read", durationMs: 900, stepMs: 10 });
	builder.toolResult({
		toolCallId: "sub",
		toolName: "Agent",
		details: runDetails("kid-1", "completed", { tokens: 100, cost: 0.4 }, 20_000),
		durationMs: 20_000,
	});
	builder.assistant({
		toolCalls: [{ id: "b1", name: "bash", arguments: { command: "bun test" } }],
		usage: { ...usage(6000, 0.2), cacheRead: 9000 },
		durationMs: 1000,
	});
	builder.toolResult({
		toolCallId: "b1",
		toolName: "bash",
		text: "fail\nCommand exited with code 1",
		isError: true,
		durationMs: 1500,
	});
	builder.assistant({
		text: "Fixed.",
		usage: { ...usage(7000, 0.3), cacheRead: 100 },
		durationMs: 800,
	});
	return builder;
}

describe("the session timeline", () => {
	test("cards, lanes and counters come from the trace with their origins", async () => {
		const builder = workSession("work");
		const trace = await traceOf("work", builder);
		const timeline = await buildSessionTimeline(trace, {
			contextWindow: async (provider, model) =>
				provider === "anthropic" && model === "claude-test" ? 15_000 : null,
			outside: [{ childId: "kid-1", tokens: 406, cost: 0.4 }],
		});
		const [card] = timeline.turns;
		expect(card).toMatchObject({
			n: 1,
			trigger: "prompt",
			llmCalls: { value: 3, origin: "counted" },
			toolCalls: { value: 4, origin: "counted" },
			errors: { value: 1, origin: "counted" },
			subagents: { value: 1, origin: "counted" },
			userWait: { value: 0, origin: "approximated" },
		});
		expect(card?.cost).toMatchObject({ origin: "recorded" });
		expect(card?.cost.value).toBeCloseTo(0.6, 12);
		expect(card?.duration.value).toBe((card?.t1 ?? 0) - (card?.t0 ?? 0));
		expect(timeline.lanes.toolTracks).toBe(3);
		expect(timeline.lanes.tracks.map((item) => item.track).sort()).toEqual([1, 2]);
		expect(timeline.context.map((point) => point.miss ?? false)).toEqual([false, false, true]);
		const [limit] = timeline.limits;
		expect(limit).toMatchObject({
			model: "anthropic/claude-test",
			origin: "approximated",
			host: 15_000,
		});
		expect(limit?.value).toBe(limit?.observed);
		const recorded = recordedTotals(
			builder
				.text()
				.trim()
				.split("\n")
				.map((line) => JSON.parse(line)),
		);
		expect(timeline.spend.at(-1)?.cost).toBeCloseTo(recorded.cost, 12);
		expect(timeline.withSubagents?.at(-1)?.cost).toBeCloseTo(recorded.cost + 0.4, 12);
		expect(timeline.headline).toBe("cost");
		expect(timeline.waits.tool).toBeGreaterThan(0);
		expect(timeline.waitsTotal).toEqual({
			value: Object.values(timeline.waits).reduce((sum, ms) => sum + ms, 0),
			origin: "approximated",
		});
		expect(timeline.peak).toEqual({
			value: Math.max(...timeline.context.map((point) => point.tokens)),
			origin: "recorded",
		});
		expect(timeline.llmCalls).toEqual({
			value: trace.events.filter((event) => event.kind === "llm").length,
			origin: "counted",
		});
	});

	test("a host window that fits the observed context is the limit; tokens head a $0 session", async () => {
		const builder = new TranscriptBuilder({ id: "free", start: T0 });
		builder.user("hi");
		builder.assistant({ text: "hello", usage: usage(100, 0), durationMs: 500 });
		const trace = await traceOf("free", builder);
		const timeline = await buildSessionTimeline(trace, { contextWindow: async () => 200_000 });
		expect(timeline.limits).toEqual([
			{
				model: "anthropic/claude-test",
				value: 200_000,
				origin: "host",
				host: 200_000,
				observed: 305,
			},
		]);
		expect(timeline.headline).toBe("tokens");
		expect(timeline.turns[0]?.cost.origin).toBe("notRecorded");
		expect(timeline.withSubagents).toBeNull();
	});

	test("a model that never reads from cache has no misses", () => {
		const call = (id: string, cacheRead: number, model = "m") =>
			({
				kind: "llm",
				id,
				parent: null,
				depth: 1,
				t0: T0,
				t1: T0,
				timing: "recorded",
				label: "",
				model,
				stop: "stop",
				tokens: { input: 10_000, output: 1, cacheRead, cacheWrite: 0, total: 0 },
				cost: 0,
				replyChars: 0,
				thinking: "none",
				calls: 0,
			}) as const;
		expect([...cacheMisses([call("a", 0), call("b", 0)])]).toEqual([]);
		expect([...cacheMisses([call("a", 0), call("b", 9000), call("c", 0)])]).toEqual(["c"]);
	});

	test("the same trace builds a byte-identical timeline", async () => {
		const trace = await traceOf("again", workSession("again"));
		const first = JSON.stringify(await buildSessionTimeline(trace));
		expect(JSON.stringify(await buildSessionTimeline(trace))).toBe(first);
	});
});

describe("budgets", () => {
	test(
		"a 2,400-call session's timeline builds within the summary budget and stays under 1 MB",
		async () => {
			const builder = new TranscriptBuilder({ id: "large-timeline", start: T0 });
			for (let turn = 0; turn < 120; turn += 1) {
				builder.user(`turn ${turn}`);
				for (let call = 0; call < 10; call += 1) {
					const calls = [0, 1].map((index) => ({
						id: `c${turn}-${call}-${index}`,
						name: index ? "read" : "bash",
						arguments: index ? { path: `src/file${call}.ts` } : { command: `bun test ${call}` },
					}));
					builder.assistant({ text: "Working.", toolCalls: calls, durationMs: 800 });
					for (const item of calls)
						builder.toolResult({ toolCallId: item.id, toolName: item.name, durationMs: 200 });
				}
				builder.advance(5 * 60_000);
			}
			const trace = await traceOf("large-timeline", builder);
			const started = performance.now();
			const timeline = await buildSessionTimeline(trace, { contextWindow: async () => 200_000 });
			const elapsed = performance.now() - started;
			expect(timeline.turns).toHaveLength(120);
			expect(JSON.stringify(timeline).length).toBeLessThan(1_000_000);
			withinBudget(elapsed, 500);
		},
		LARGE_TEST_MS,
	);
});
