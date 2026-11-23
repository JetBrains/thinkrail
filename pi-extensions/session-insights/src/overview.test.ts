import { afterAll, describe, expect, test } from "bun:test";
import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { cached, TranscriptBuilder, tempDir, usage, writeSession } from "../test/builders.ts";
import { statsOver } from "../test/stats.ts";
import { buildContextView } from "./context.ts";
import { OVERVIEW_RULES } from "./core.ts";
import { buildSessionCost } from "./costWhy.ts";
import { buildFindingsList } from "./findings.ts";
import { buildOverviewCards, composeOverview } from "./overview.ts";
import { createRedactor } from "./redact.ts";
import { JsonStore } from "./store.ts";
import { buildSessionTimeline } from "./timeline.ts";
import { TraceStore } from "./traceStore.ts";
import { SubagentActivityCache } from "./waves.ts";

const root = tempDir("overview");
afterAll(() => rmSync(root, { recursive: true, force: true }));

const T0 = Date.parse("2026-11-03T09:00:00.000Z");
const WINDOW = async () => 200_000;
const redactor = createRedactor("/home/alice");

function todo(id: string, title: string, status: string) {
	return {
		id,
		title,
		status,
		origin: "agent",
		createdAt: "2026-11-03T09:00:00.000Z",
		updatedAt: "2026-11-03T09:00:00.000Z",
	};
}

function call(
	builder: TranscriptBuilder,
	id: string,
	name: string,
	args: Record<string, unknown>,
	result: { isError?: boolean; text?: string; details?: unknown; stepMs?: number } = {},
) {
	builder.assistant({
		toolCalls: [{ id, name, arguments: args }],
		usage: cached({ input: 2000, cacheRead: 6000, cacheWrite: 100 }, 0.02),
	});
	return builder.toolResult({ toolCallId: id, toolName: name, ...result });
}

/** A session with a plan, a skill, a failed edit and its retry, a question to the user and rework. */
function workSession(id: string, cwd = "/work/a") {
	const builder = new TranscriptBuilder({ id, cwd, start: T0 });
	builder.user("Add the streak report with tests");
	call(builder, `${id}-s`, "read", { path: "/home/alice/.pi/skills/review/SKILL.md" });
	call(
		builder,
		`${id}-w`,
		"todo_write",
		{ groups: [] },
		{
			details: {
				plan: {
					todos: [
						todo("t_a1", "Add the streak logic", "pending"),
						todo("t_b2", "Drop the old report", "pending"),
						todo("t_c3", "Add the report command", "pending"),
					],
					groups: [],
				},
			},
		},
	);
	call(
		builder,
		`${id}-u1`,
		"todo_update",
		{ id: "t_a1", status: "in_progress" },
		{ details: { todo: todo("t_a1", "Add the streak logic", "in_progress"), paused: [] } },
	);
	call(
		builder,
		`${id}-e0`,
		"edit",
		{ path: "src/stats.py", edits: [] },
		{
			isError: true,
			text: "Edit tool input is invalid. edits must contain at least one replacement.",
		},
	);
	call(builder, `${id}-e1`, "edit", {
		path: "src/stats.py",
		edits: [{ oldText: "a", newText: "b" }],
	});
	for (let n = 2; n <= 5; n++)
		call(builder, `${id}-e${n}`, "edit", {
			path: "src/stats.py",
			edits: [{ oldText: `${n}`, newText: `${n + 1}` }],
		});
	call(
		builder,
		`${id}-r`,
		"todo_remove",
		{ id: "t_b2" },
		{ details: { todo: todo("t_b2", "Drop the old report", "pending") } },
	);
	call(
		builder,
		`${id}-u2`,
		"todo_update",
		{ id: "t_a1", status: "done" },
		{ details: { todo: todo("t_a1", "Add the streak logic", "done"), paused: [] } },
	);
	call(builder, `${id}-q`, "ask_user_question", { question: "Ship it?" }, { stepMs: 30_000 });
	builder.assistant({ text: "Done.", usage: usage(50, 0.01) });
	return { builder };
}

async function overviewOf(
	file: string,
	sessionId: string,
	options: { budgetMs?: number; findings?: boolean } = {},
) {
	const traces = new TraceStore({ redactor, sliceMs: 1000 });
	const trace = await traces.trace(file);
	if (!trace) throw new Error("no trace");
	const { input, index } = await statsOver([file], { budgetMs: options.budgetMs ?? 60_000 });
	const state = index.state();
	const findings = await buildFindingsList(
		{ ...input, store: new JsonStore(join(root, `store-${sessionId}`)), redactor },
		state,
	);
	const cards = await buildOverviewCards({
		trace,
		contextWindow: WINDOW,
		subagents: {
			trace,
			file,
			store: traces,
			transcripts: new Map(),
			removed: false,
			activity: new SubagentActivityCache(),
		},
	});
	const overview = composeOverview(cards, { sessionId, outcome: "succeeded", findings });
	return { overview, trace };
}

describe("session.overview", () => {
	test("composes the sections' figures from one trace revision", async () => {
		const { builder } = workSession("ov-work");
		const file = writeSession(root, "work", builder);
		const { overview, trace } = await overviewOf(file, "ov-work");
		expect(overview.revision).toBe(trace.meta.revision);

		const { happened } = overview;
		expect(happened).toMatchObject({
			outcome: "succeeded",
			turns: { value: 1, origin: "counted" },
			llmCalls: { value: 13, origin: "counted" },
			toolCalls: { value: 12, origin: "counted" },
			toolFailures: { value: 1, origin: "counted" },
			recovered: { value: 1, origin: "counted" },
			start: { value: trace.meta.start, origin: "counted" },
			end: { value: trace.meta.end, origin: "counted" },
			skills: ["review"],
		});
		expect(happened.span.value).toBe((trace.meta.end ?? 0) - (trace.meta.start ?? 0));
		expect(happened.userWait.origin).toBe("approximated");
		expect(happened.userWait.value).toBeGreaterThan(20_000);
		expect(happened.activity?.llmCalls).toBe(13);
		expect(happened.activity?.errors).toBe(1);
		expect(happened.plan).toMatchObject({
			done: { value: 1, origin: "counted" },
			total: { value: 2, origin: "counted" },
			more: 0,
		});
		expect(happened.plan?.steps.map((step) => [step.n, step.title, step.status])).toEqual([
			[1, "Add the streak logic", "done"],
			[3, "Add the report command", "pending"],
		]);
		expect(happened.plan?.steps[0]?.errors.value).toBe(1);
		expect(happened.plan?.steps[0]?.cost.value).toBeGreaterThan(0);
		expect(happened.plan?.steps[0]?.events.length).toBeGreaterThan(0);

		const cost = await buildSessionCost(trace, { contextWindow: WINDOW });
		expect(overview.cost).toMatchObject({
			headline: "cost",
			total: cost.total,
			diagnosis: cost.diagnosis,
			calls: { value: cost.calls.length, origin: "counted" },
			compactions: { value: 0, origin: "counted" },
			rewrites: { value: 0, origin: "approximated" },
			perBar: 1,
		});
		expect(overview.cost.bars).toEqual(cost.calls.map((item) => item.cost));
		expect(overview.cost.cacheShare.value).toBeCloseTo(cost.diagnosis.cacheReadShare, 12);

		expect(overview.errors).toMatchObject({
			failures: { value: 1, origin: "counted" },
			recovered: { value: 1, origin: "counted" },
			chains: 1,
		});
		expect(overview.errors?.recoveredIn.value).toBeGreaterThan(0);
		expect(overview.errors?.chain).toMatchObject({
			kind: "tool",
			outcome: "recovered",
			between: [0],
			line: "Edit tool input is invalid. edits must contain at least one replacement.",
		});
		expect(
			overview.errors?.chain?.attempts.map((item) => [item.name, item.label, item.failed]),
		).toEqual([
			["edit", "src/stats.py", true],
			["edit", "src/stats.py", false],
		]);
		const first = trace.events.find(
			(event) => event.id === overview.errors?.chain?.attempts[0]?.eventId,
		);
		expect(first).toMatchObject({ kind: "tool", tool: "edit", error: true });

		const context = await buildContextView(trace, { contextWindow: WINDOW });
		expect(overview.context).toMatchObject({
			peak: context.peak,
			average: context.average,
			cacheShare: context.cacheShare,
			misses: context.misses,
			window: { value: 200_000, origin: "host" },
			compactions: { value: 0, origin: "counted" },
		});
		expect(overview.context.peakShare.value).toBeCloseTo((context.peak.value ?? 0) / 200_000, 12);

		expect(overview.files.totals).toMatchObject({ changed: 1, failed: 1 });
		expect(overview.files.rows).toEqual([
			expect.objectContaining({ path: "src/stats.py", inside: true, failed: true, rework: true }),
		]);
		expect(overview.files.more).toBe(0);

		expect(overview.subagents).toEqual({ count: { value: 0, origin: "counted" }, overview: null });
		expect(overview.turns).toEqual({
			prompts: { value: 1, origin: "counted" },
			asks: { value: 1, origin: "counted" },
		});

		expect(overview.digests).toEqual({ ready: 1, total: 1, stale: 0 });
		expect(overview.findings?.map((finding) => [finding.rule, finding.subject])).toContainEqual([
			"rework",
			"src/stats.py",
		]);
		const rework = overview.findings?.find((finding) => finding.rule === "rework");
		expect(rework?.link?.count).toBe(5);
		expect(rework?.sessions).toBe(1);
	});

	test("a revision's cards are built in stages that yield, and stop at the next one once aborted", async () => {
		const { builder } = workSession("ov-yield");
		const file = writeSession(root, "yield", builder);
		const trace = await new TraceStore({ redactor, sliceMs: 1000 }).trace(file);
		if (!trace) throw new Error("no trace");
		const controller = new AbortController();
		const reason = new Error("switched off");
		const input = { trace, contextWindow: WINDOW, subagents: null, sliceMs: 0 };
		setImmediate(() => controller.abort(reason));
		await expect(buildOverviewCards({ ...input, signal: controller.signal })).rejects.toBe(reason);
		const cards = await buildOverviewCards(input);
		expect(cards.revision).toBe(trace.meta.revision);
		expect(cards).not.toHaveProperty("findings");
		const answer = composeOverview(cards, {
			sessionId: "ov-yield",
			outcome: "failed",
			findings: await buildFindingsList(
				{
					...(await statsOver([file], { budgetMs: 0 })).input,
					store: new JsonStore(join(root, "store-ov-yield")),
					redactor,
				},
				{ phase: "cold", indexed: 0, total: 1 },
			),
		});
		expect(answer.happened.outcome).toBe("failed");
		expect(answer.cost).toBe(cards.cost);
		expect(answer.findings).toBeNull();
	});

	test("findings wait for the scope's digests instead of blocking the cards", async () => {
		const { builder } = workSession("ov-cold");
		const file = writeSession(root, "cold", builder);
		const { overview } = await overviewOf(file, "ov-cold", { budgetMs: 0 });
		expect(overview.findings).toBeNull();
		expect(overview.digests.ready).toBeLessThan(overview.digests.total);
		expect(overview.happened.turns.value).toBe(1);
	});

	test("a retry that never ran reads as missing, not as a success", async () => {
		const builder = new TranscriptBuilder({ id: "retry-stopped", cwd: "/work/a", start: T0 });
		builder.user("Run the parser tests");
		builder.assistant({
			toolCalls: [{ id: "b1", name: "bash", arguments: { command: "bun test parser" } }],
		});
		builder.toolResult({
			toolCallId: "b1",
			toolName: "bash",
			isError: true,
			text: "1 fail\nCommand exited with code 1",
		});
		builder.assistant({
			toolCalls: [{ id: "b2", name: "bash", arguments: { command: "bun test parser --bail" } }],
			stopReason: "aborted",
		});
		const file = writeSession(root, "retry-stopped", builder);
		const { overview } = await overviewOf(file, "retry-stopped");
		const chain = overview?.errors?.chain;
		expect(chain?.outcome).toBe("unfinished");
		expect(chain?.attempts.map((attempt) => [attempt.failed, attempt.missing ?? false])).toEqual([
			[true, false],
			[false, true],
		]);
	});

	test("a session without failures, plan or files has no errors card and empty cards", async () => {
		const builder = new TranscriptBuilder({ id: "ov-quiet", cwd: "/work/a", start: T0 });
		builder.user("What time is it?");
		builder.assistant({ text: "Noon.", usage: usage(10, 0) });
		const file = writeSession(root, "quiet", builder);
		const { overview } = await overviewOf(file, "ov-quiet");
		expect(overview.errors).toBeNull();
		expect(overview.happened.plan).toBeNull();
		expect(overview.happened.skills).toEqual([]);
		expect(overview.files.rows).toEqual([]);
		expect(overview.cost.headline).toBe("tokens");
		expect(overview.cost.bars).toEqual([40 + 6]);
		expect(overview.context.window.origin).toBe("host");
	});

	test("folds a long session's calls into at most callBars bars, each its costliest call", async () => {
		const builder = new TranscriptBuilder({ id: "ov-long", cwd: "/work/a", start: T0 });
		builder.user("Go");
		for (let n = 1; n <= 250; n++) builder.assistant({ text: "…", usage: usage(10, n / 1000) });
		const file = writeSession(root, "long", builder);
		const { overview } = await overviewOf(file, "ov-long");
		expect(overview.cost.perBar).toBe(Math.ceil(250 / OVERVIEW_RULES.callBars));
		expect(overview.cost.bars).toHaveLength(Math.ceil(250 / overview.cost.perBar));
		expect(overview.cost.bars[0]).toBeCloseTo(0.003, 12);
		expect(overview.cost.bars.at(-1)).toBeCloseTo(0.25, 12);
	});

	test("the brainstorming fixture's cards agree with its sections", async () => {
		const dir = join(root, "fixture", "--tmp-thinkrail-e2e-workflow-ws-1--");
		mkdirSync(dir, { recursive: true });
		const file = join(dir, "session.jsonl");
		copyFileSync(
			join(import.meta.dir, "../../../e2e/workflows/fixtures/brainstorming-mid-flow/session.jsonl"),
			file,
		);
		const traces = new TraceStore({ redactor: createRedactor("/home/fixture") });
		const trace = await traces.trace(file);
		if (!trace) throw new Error("no trace");
		const { overview } = await overviewOf(file, trace.sessionId);
		const timeline = await buildSessionTimeline(trace, { contextWindow: WINDOW });
		expect(overview.revision).toBe(trace.meta.revision);
		expect(overview.happened.llmCalls).toEqual(timeline.llmCalls);
		expect(overview.happened.turns.value).toBe(timeline.turns.length);
		expect(overview.happened.skills).toEqual(["brainstorming", "asking-user-questions"]);
		expect(overview.turns.asks.value).toBe(1);
		expect(overview.cost.total).toEqual(
			(await buildSessionCost(trace, { contextWindow: WINDOW })).total,
		);
	});
});
