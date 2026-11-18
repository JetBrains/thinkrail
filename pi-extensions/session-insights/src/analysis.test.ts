import { afterAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { runDetails, TranscriptBuilder, tempDir, usage, writeSession } from "../test/builders.ts";
import {
	CONTAINED_PIN,
	CONTAINED_SECRET_CALLS,
	CONTAINED_SECRETS,
	SECRET_ARGS,
	SECRET_CALLS,
	sessionOf,
} from "../test/calls.ts";
import {
	buildErrorDetail,
	buildSessionAnalysis,
	parseErrorDetailParams,
	parseSubagentParams,
	wordDiff,
} from "./analysis.ts";
import type { SubagentEvent } from "./core.ts";
import { errorLine, normalizeError, planFromText } from "./facts.ts";
import { createRedactor } from "./redact.ts";
import { taskTitles } from "./trace.ts";
import { parseEventParams, parseTraceParams } from "./traceQueries.ts";
import { TraceStore } from "./traceStore.ts";
import {
	buildSessionSubagents,
	buildSubagentDetail,
	type ChildTranscript,
	SubagentActivityCache,
} from "./waves.ts";

const root = tempDir("analysis");
afterAll(() => rmSync(root, { recursive: true, force: true }));
const T0 = Date.parse("2026-11-02T09:00:00.000Z");
const redactor = createRedactor("/home/alice");

function store(): TraceStore {
	return new TraceStore({ redactor, sliceMs: 1000 });
}

let files = 0;
async function traceOf(builder: TranscriptBuilder) {
	files += 1;
	const file = writeSession(root, `s${files}`, builder);
	const traces = store();
	const trace = await traces.trace(file);
	if (!trace) throw new Error("no trace");
	return { file, trace, traces };
}

function todo(id: string, title: string, status: string, origin = "agent") {
	return {
		id,
		title,
		status,
		origin,
		createdAt: "2026-11-02T09:00:00.000Z",
		updatedAt: "2026-11-02T09:00:00.000Z",
	};
}

/** One pi-todos call and its result, as pi writes them. */
function todoCall(
	builder: TranscriptBuilder,
	id: string,
	name: string,
	args: Record<string, unknown>,
	details: unknown,
	text = "ok",
) {
	builder.assistant({ toolCalls: [{ id, name, arguments: args }] });
	return builder.toolResult({ toolCallId: id, toolName: name, details, text });
}

function planSession() {
	const builder = new TranscriptBuilder({ id: "plan-session", start: T0 });
	builder.user("ship the release");
	todoCall(
		builder,
		"w1",
		"todo_write",
		{ groups: [] },
		{
			plan: {
				todos: [],
				groups: [
					{
						id: "g_1",
						title: "Release",
						todos: [
							todo("t_a1", "Bump the version", "pending"),
							todo("t_b2", "Write the changelog", "pending"),
							todo("t_c3", "Tag the release", "pending"),
						],
					},
				],
			},
		},
	);
	todoCall(
		builder,
		"u1",
		"todo_update",
		{ id: "t_a1", status: "in_progress" },
		{ todo: todo("t_a1", "Bump the version", "in_progress"), paused: [] },
	);
	builder.assistant({
		toolCalls: [{ id: "b1", name: "bash", arguments: { command: "bun run bump" } }],
		usage: usage(100, 0.5),
	});
	builder.toolResult({ toolCallId: "b1", toolName: "bash", isError: true, text: "error: no" });
	todoCall(
		builder,
		"u2",
		"todo_update",
		{ id: "t_b2", status: "in_progress" },
		{
			todo: todo("t_b2", "Write the changelog", "in_progress"),
			paused: [todo("t_a1", "Bump the version", "pending")],
		},
	);
	todoCall(
		builder,
		"u3",
		"todo_update",
		{ id: "t_b2", status: "done" },
		{ todo: todo("t_b2", "Write the changelog", "done"), paused: [] },
	);
	builder.user("drop the tag step");
	todoCall(
		builder,
		"w2",
		"todo_write",
		{ groups: [] },
		{
			plan: {
				todos: [],
				groups: [
					{
						id: "g_1",
						title: "Release",
						todos: [
							todo("t_a1", "Bump the version", "pending"),
							todo("t_b2", "Write the changelog", "done"),
						],
					},
				],
			},
		},
	);
	todoCall(
		builder,
		"a1",
		"todo_add",
		{ title: "Publish", group: "Release" },
		{ todo: todo("t_d4", "Publish", "pending") },
	);
	todoCall(builder, "r1", "todo_remove", { id: "t_d4" }, { id: "t_d4" });
	todoCall(
		builder,
		"l1",
		"todo_list",
		{},
		{
			plan: {
				todos: [todo("t_e5", "Ask about docs", "pending", "user")],
				groups: [
					{
						id: "g_1",
						title: "Release",
						todos: [
							todo("t_a1", "Bump the version", "done"),
							todo("t_b2", "Write the changelog", "done"),
						],
					},
				],
			},
		},
	);
	todoCall(
		builder,
		"s1",
		"todo_plan_summary",
		{ summary: "## Summary\nShipped." },
		{ summary: "x" },
	);
	return builder;
}

describe("the todo plan", () => {
	test("is rebuilt from pi-todos calls: rewrites, removals, pauses and list-only items", async () => {
		const { trace } = await traceOf(planSession());
		const { plan, turns } = buildSessionAnalysis(trace, []);
		if (!plan) throw new Error("no plan");
		expect(plan.steps.map((step) => [step.id, step.status])).toEqual([
			["t_a1", "done"],
			["t_b2", "done"],
			["t_c3", "removed"],
			["t_d4", "removed"],
			["t_e5", "pending"],
		]);
		expect(plan.rewrites).toBe(1);
		expect(plan.calls).toBe(9);
		expect(plan.groups).toEqual([{ id: "g_1", title: "Release" }]);
		expect(plan.summaries.map((note) => note.text)).toEqual(["## Summary Shipped."]);
		const [bump, changelog, , publish, docs] = plan.steps;
		expect(bump?.changes.map((change) => change.status)).toEqual([
			"pending",
			"inProgress",
			"pending",
			"done",
		]);
		expect(bump?.changes.at(-1)?.snapshot).toBe(true);
		expect(bump?.active).toHaveLength(1);
		expect(bump?.toolCalls.value).toBe(2);
		expect(bump?.errors.value).toBe(1);
		expect(bump?.cost.origin).toBe("recorded");
		expect(bump?.cost.value).toBeCloseTo(0.51, 6);
		expect(changelog?.active).toHaveLength(1);
		expect(publish?.group).toBe("Release");
		expect(docs?.origin).toBe("user");
		expect(docs?.listedOnly).toBe(true);
		expect(turns.map((turn) => [turn.steps, turn.done])).toEqual([
			[3, 1],
			[2, 0],
		]);
	});

	test("falls back to the result text when a result has no details", () => {
		const text =
			"Wrote the plan (2 item(s) total):\n▸ Release [active 1/2]\n  [x] Bump — t_a1b2c3\n  [~] Tag it — t_d4e5f6\nLoose queue:\n[ ] Docs — t_0a0b0c";
		const parsed = planFromText(text, redactor);
		expect(parsed.groups).toEqual([{ id: "text:Release", title: "Release" }]);
		expect(parsed.items.map((item) => [item.id, item.status, item.group])).toEqual([
			["t_a1b2c3", "done", "Release"],
			["t_d4e5f6", "inProgress", "Release"],
			["t_0a0b0c", "pending", null],
		]);
	});
});

describe("skills", () => {
	test("activate on a successful SKILL.md read or a /skill prompt, scoped to the turn or the next skill", async () => {
		const builder = new TranscriptBuilder({ id: "skills", start: T0 });
		builder.user("start");
		builder.assistant({
			toolCalls: [
				{ id: "r1", name: "read", arguments: { path: "/home/alice/.pi/skills/todos/SKILL.md" } },
			],
		});
		builder.toolResult({ toolCallId: "r1", toolName: "read", text: "# todos" });
		builder.assistant({
			toolCalls: [{ id: "r2", name: "read", arguments: { path: "skills/missing/SKILL.md" } }],
		});
		builder.toolResult({ toolCallId: "r2", toolName: "read", text: "ENOENT", isError: true });
		builder.assistant({
			toolCalls: [{ id: "r3", name: "read", arguments: { path: "skills/my-skill/SKILL.md" } }],
		});
		builder.toolResult({ toolCallId: "r3", toolName: "read", text: "# mine" });
		builder.assistant({ text: "done" });
		builder.user("/skill:shipping-a-pr open it");
		builder.assistant({ text: "opening" });
		const { trace } = await traceOf(builder);
		const { skills, turns } = buildSessionAnalysis(trace, []);
		expect(skills.map((skill) => [skill.name, skill.via, skill.workflow, skill.scopeBy])).toEqual([
			["todos", "read", true, "nextSkill"],
			["my-skill", "read", false, "turnEnd"],
			["shipping-a-pr", "prompt", true, "turnEnd"],
		]);
		expect(skills[0]?.scopeEnd).toBe(skills[1]?.t);
		expect(turns.map((turn) => turn.skills)).toEqual([["todos", "my-skill"], ["shipping-a-pr"]]);
	});
});

describe("errors and repeats", () => {
	function frictionSession() {
		const builder = new TranscriptBuilder({ id: "friction", start: T0 });
		builder.user("fix it");
		const call = (
			id: string,
			name: string,
			args: Record<string, unknown>,
			error: string | null,
		) => {
			builder.assistant({ toolCalls: [{ id, name, arguments: args }] });
			builder.toolResult({
				toolCallId: id,
				toolName: name,
				isError: error !== null,
				text: error ?? "ok",
			});
		};
		call(
			"c1",
			"bash",
			{ command: "bunx biome check src/a.ts" },
			"src/a.ts:12:4 error: Forbidden non-null assertion.",
		);
		call("c2", "edit", { path: "src/a.ts", oldText: "a!", newText: "a" }, null);
		call(
			"c3",
			"bash",
			{ command: "bunx biome check --write src/a.ts" },
			"src/a.ts:40:1 error: Sort imports.",
		);
		call("c4", "bash", { command: "bunx biome check --write src/a.ts" }, null);
		call("c5", "read", { path: "src/b.ts" }, "ENOENT: no such file /home/alice/src/b.ts");
		call("c6", "grep", { pattern: "x" }, null);
		call("c7", "grep", { pattern: "x" }, null);
		call("c8", "grep", { pattern: "x" }, null);
		call("c9", "bash", { command: "gh pr checks 12" }, "checks failed 3");
		call("c10", "bash", { command: "gh pr checks 12 --watch" }, "checks failed 4");
		builder.assistant({ errorMessage: "overloaded 529", stopReason: "error", model: "m-a" });
		builder.assistant({ errorMessage: "overloaded 529", stopReason: "error", model: "m-a" });
		builder.user("try again");
		builder.assistant({ text: "ok", model: "m-b" });
		builder.assistant({ errorMessage: "network", stopReason: "error", model: "m-b" });
		return builder;
	}

	test("find repeats, recovery chains, clusters and recovery rates", async () => {
		const { trace } = await traceOf(frictionSession());
		const analysis = buildSessionAnalysis(trace, []);
		expect(analysis.repeats.map((group) => [group.tool, group.ids.length])).toEqual([
			["bash", 2],
			["grep", 3],
		]);
		const tool = analysis.chains.filter((chain) => chain.kind === "tool");
		expect(tool.map((chain) => [chain.name, chain.attempts.length, chain.outcome])).toEqual([
			["bash", 3, "recovered"],
			["read", 1, "changedApproach"],
			["bash", 2, "gaveUp"],
		]);
		expect(tool[0]?.between.map((gap) => gap.length)).toEqual([1, 0]);
		expect(tool[0]?.recoveredIn.value).toBeGreaterThan(0);
		expect(tool[0]?.line).toBe("src/a.ts:12:4 error: Forbidden non-null assertion.");
		const model = analysis.chains.filter((chain) => chain.kind === "model");
		expect(
			model.map((chain) => [chain.attempts.length, chain.outcome, chain.switches, chain.prompts]),
		).toEqual([
			[3, "afterSwitch", 1, 1],
			[1, "never", 0, 0],
		]);
		expect(analysis.toolRecovery).toEqual([
			{ tool: "bash", failures: 4, chains: 2, recovered: 1, changedApproach: 0, gaveUp: 1 },
			{ tool: "read", failures: 1, chains: 1, recovered: 0, changedApproach: 1, gaveUp: 0 },
		]);
		expect(analysis.toolFailures).toBe(5);
		expect(analysis.modelRecovery).toEqual({
			failures: 3,
			chains: 2,
			sameModel: 0,
			afterSwitch: 1,
			never: 1,
		});
		const keys = analysis.clusters.map((cluster) => [cluster.key, cluster.ids.length]);
		expect(keys).toContainEqual(["model: overloaded <n>", 2]);
		expect(keys).toContainEqual(["bash: checks failed <n>", 2]);
		expect(keys).toContainEqual(["read: ENOENT: no such file <path>", 1]);
		expect(analysis.clusters[0]?.ids.length).toBe(2);
	});

	test("a retry needs the same turn and the window of four calls", async () => {
		const builder = new TranscriptBuilder({ id: "window", start: T0 });
		builder.user("go");
		const call = (id: string, name: string, args: Record<string, unknown>, error: boolean) => {
			builder.assistant({ toolCalls: [{ id, name, arguments: args }] });
			builder.toolResult({
				toolCallId: id,
				toolName: name,
				isError: error,
				text: error ? "fail" : "ok",
			});
		};
		call("a", "bash", { command: "make test" }, true);
		for (const id of ["r1", "r2", "r3", "r4"]) call(id, "read", { path: `${id}.ts` }, false);
		call("b", "bash", { command: "make test" }, false);
		builder.user("again");
		call("c", "bash", { command: "make lint" }, true);
		builder.user("next turn");
		call("d", "bash", { command: "make lint" }, false);
		const { trace } = await traceOf(builder);
		const chains = buildSessionAnalysis(trace, []).chains;
		expect(chains.map((chain) => [chain.attempts.length, chain.outcome])).toEqual([
			[1, "changedApproach"],
			[1, "changedApproach"],
		]);
	});

	test("an error detail diffs the attempts' arguments and lists the edits between them", async () => {
		const { file, trace, traces } = await traceOf(frictionSession());
		const detail = await buildErrorDetail(traces, file, trace, 0);
		if (!detail) throw new Error("no detail");
		expect(detail.attempts.map((attempt) => attempt.failed)).toEqual([true, true, false]);
		expect(detail.attempts[0]?.argument?.text).toBe("bunx biome check src/a.ts");
		expect(detail.attempts[1]?.diff).toEqual([
			{ op: "same", text: "bunx biome check " },
			{ op: "added", text: "--write " },
			{ op: "same", text: "src/a.ts" },
		]);
		expect(detail.attempts[1]?.between.map((step) => [step.tool, step.edit])).toEqual([
			["edit", true],
		]);
		expect(detail.attempts[0]?.error?.text).toContain("Forbidden non-null assertion");
		expect(detail.cluster?.kind).toBe("tool");
		expect(await buildErrorDetail(traces, file, trace, 99)).toBeNull();
	});

	test("an attempt's arguments without a main one show secret-named values masked, however long", async () => {
		const long = `${"c4".repeat(1_600)}`;
		const { file, trace, traces } = await traceOf(
			sessionOf("secret-attempts", [
				{
					prompt: "Connect",
					calls: [
						...SECRET_CALLS.slice(0, 2),
						["db_connect", { password: long, host: "db.local" }, true],
						["db_connect", { password: long, host: "db.remote" }],
					],
				},
			]),
		);
		for (const chain of [0, 1]) {
			const detail = await buildErrorDetail(traces, file, trace, chain);
			const text = JSON.stringify(detail);
			expect(detail?.attempts[0]?.argument?.text).toContain('"password":"[redacted]"');
			expect(text).not.toContain(SECRET_ARGS.password);
			expect(text).not.toContain("c4c4c4c4");
		}
	});

	test("an attempt's arguments show every value inside a secret-named container masked", async () => {
		const { file, trace, traces } = await traceOf(
			sessionOf("contained-attempts", [{ prompt: "Rotate", calls: CONTAINED_SECRET_CALLS }]),
		);
		const detail = await buildErrorDetail(traces, file, trace, 0);
		expect(detail?.attempts.map((attempt) => attempt.argument?.text)).toEqual([
			'{"path":"kv/app","credentials":{"value":"[redacted]","pin":"[redacted]"}}',
			'{"path":"kv/app","credentials":{"value":"[redacted]","pin":"[redacted]"}}',
		]);
		const text = JSON.stringify(detail);
		for (const value of Object.values(CONTAINED_SECRETS)) expect(text).not.toContain(value);
		expect(text).not.toContain(String(CONTAINED_PIN));
	});

	test("normalizes error lines into cluster keys", () => {
		expect(errorLine("12 passing\n(pass) a\nerror: boom at 3\nCommand exited with code 1")).toBe(
			"error: boom at 3",
		);
		expect(normalizeError('Could not find "foo" in ./src/x.ts at line 12 (id 0a1b2c3d4e)')).toBe(
			'Could not find "…" in <path> at line <n> (id <id>)',
		);
		expect(wordDiff("a b c", "a x c")).toEqual([
			{ op: "same", text: "a " },
			{ op: "removed", text: "b" },
			{ op: "added", text: "x" },
			{ op: "same", text: " c" },
		]);
	});
});

describe("subagent waves", () => {
	function child(id: string, start: number, failing: boolean) {
		const builder = new TranscriptBuilder({ id, start });
		builder.user("task");
		builder.assistant({ toolCalls: [{ id: "x", name: "bash", arguments: { command: "ls" } }] });
		builder.toolResult({
			toolCallId: "x",
			toolName: "bash",
			isError: failing,
			text: failing ? "error: denied" : "ok",
		});
		builder.assistant({ text: "found it" });
		return builder;
	}

	function parent() {
		const builder = new TranscriptBuilder({ id: "wave-parent", start: T0 });
		builder.user("review the PRs");
		builder.assistant({ text: "Earlier I said we should split the review." });
		builder.assistant({
			text: "I'm spinning up two reviewers, one per PR.",
			toolCalls: [
				{
					id: "s1",
					name: "Agent",
					arguments: {
						subagent_type: "reviewer",
						task: "You review PRs.\n\nOverlap to analyze: PR #1 fix",
					},
				},
				{
					id: "s2",
					name: "Agent",
					arguments: {
						subagent_type: "reviewer",
						task: "You review PRs.\n\nOverlap to analyze: PR #2 feat",
					},
				},
			],
		});
		builder.toolResult({
			toolCallId: "s1",
			toolName: "Agent",
			text: 'Subagent "reviewer" (c1) completed: PR #1 is fine',
			details: runDetails("child-1", "completed", { tokens: 10, cost: 0.1 }, 30_000),
		});
		builder.toolResult({
			toolCallId: "s2",
			toolName: "Agent",
			text: "PR #2 conflicts",
			details: runDetails("child-2", "failed", { tokens: 20, cost: 0.2 }, 20_000),
		});
		builder.assistant({ text: "Both reviews are back." });
		builder.advance(60_000);
		builder.assistant({
			thinking: [{ thinking: "One more scout." }],
			toolCalls: [
				{ id: "s3", name: "Agent", arguments: { subagent_type: "scout", task: "Find the docs" } },
			],
		});
		builder.toolResult({
			toolCallId: "s3",
			toolName: "Agent",
			text: "queued",
			details: { ...runDetails("child-3", "running", { tokens: 0, cost: 0 }), status: "running" },
		});
		builder.customMessage(
			"subagent-completion",
			{ ...runDetails("child-3", "completed", { tokens: 5, cost: 0.05 }), delivery: "run" },
			"Docs are in docs/",
		);
		builder.assistant({ text: "Thanks." });
		return builder;
	}

	async function input(removed = false) {
		const { file, trace, traces } = await traceOf(parent());
		const transcripts = new Map<string, ChildTranscript>();
		for (const [id, failing] of [
			["child-1", false],
			["child-2", true],
		] as const) {
			const childFile = writeSession(root, `children-${files}`, child(id, T0 + 5000, failing));
			transcripts.set(id, { childId: id, file: childFile, spend: null });
		}
		return {
			trace,
			file,
			store: traces,
			transcripts,
			removed,
			activity: new SubagentActivityCache(),
		};
	}

	test("titles skip the preamble every task shares", () => {
		expect(
			taskTitles([
				["You review PRs.", "Overlap to analyze: PR #1 fix"],
				["You review PRs.", "Overlap to analyze: PR #2 feat"],
				["Find the docs"],
			]),
		).toEqual(["Overlap to analyze: PR #1 fix", "Overlap to analyze: PR #2 feat", "Find the docs"]);
	});

	test("group spawns into waves with lanes, quotes, results and where the parent read them", async () => {
		const built = await input();
		const subagents = built.trace.events.filter(
			(event): event is SubagentEvent => event.kind === "subagent",
		);
		expect(subagents.map((event) => event.label)).toEqual([
			"Overlap to analyze: PR #1 fix",
			"Overlap to analyze: PR #2 feat",
			"Find the docs",
		]);
		const view = await buildSessionSubagents(built);
		expect(view.waves.map((wave) => [wave.n, wave.childIds, wave.lanes])).toEqual([
			[1, ["child-1", "child-2"], 2],
			[2, ["child-3"], 1],
		]);
		const [first, second, third] = view.runs;
		expect(first?.rationale).toMatchObject({
			source: "text",
			text: "I'm spinning up two reviewers, one per PR.",
		});
		expect(third?.rationale).toMatchObject({ source: "thinking", text: "One more scout." });
		expect(first?.result).toMatchObject({
			via: "Agent",
			status: "completed",
			text: "PR #1 is fine",
		});
		expect(third?.result).toMatchObject({ via: "completion", text: "Docs are in docs/" });
		expect(first?.consumedBy).not.toBeNull();
		expect(first?.consumedBy).toBe(second?.consumedBy ?? "");
		for (const run of [first, second])
			expect(run?.readDelayMs).toBe(
				Math.max(0, (run?.consumedAt ?? 0) - Math.max(run?.t1 ?? 0, run?.result?.at ?? 0)),
			);
		expect(first?.transcript).toBe("available");
		expect(third?.transcript).toBe("missing");
		expect(first?.activity?.llmCalls).toBe(2);
		expect(second?.activity?.errors).toBe(1);
		expect(view.overview).toMatchObject({ maxParallel: 2, failed: 1, withErrors: 1 });
		expect(view.overview.roles).toEqual([
			{ role: "reviewer", n: 2 },
			{ role: "scout", n: 1 },
		]);
		const again = await buildSessionSubagents(await input());
		expect(JSON.stringify({ ...again, revision: "" })).toBe(
			JSON.stringify({ ...view, revision: "" }),
		);
	});

	test("a subagent's detail carries its task, failures, tools and wave", async () => {
		const built = await input();
		const detail = await buildSubagentDetail(built, "child-2");
		if (!detail) throw new Error("no detail");
		expect(detail.task?.text).toContain("Overlap to analyze: PR #2 feat");
		expect(detail.rationale?.text).toBe("I'm spinning up two reviewers, one per PR.");
		expect(detail.result?.text).toBe("PR #2 conflicts");
		expect(detail.tools).toEqual([{ tool: "bash", family: "discovery", calls: 1, errors: 1 }]);
		expect(detail.failures).toEqual([
			{ eventId: "tool:00000002:0", tool: "bash", line: "error: denied" },
		]);
		expect(detail.siblings.map((sibling) => sibling.childId)).toEqual(["child-1", "child-2"]);
		expect(await buildSubagentDetail(built, "nope")).toBeNull();
		const removed = await buildSubagentDetail(
			{ ...built, transcripts: new Map(), removed: true },
			"child-1",
		);
		expect(removed?.run.transcript).toBe("removed");
		expect(removed?.run.activity).toBeNull();
	});
});

describe("params", () => {
	test("child ids, chains and subagents are validated", () => {
		expect(parseTraceParams({ sessionId: "s", childId: "c" })).toEqual({
			sessionId: "s",
			childId: "c",
		});
		expect(parseEventParams({ sessionId: "s", eventId: "e", childId: "c" })).toEqual({
			sessionId: "s",
			eventId: "e",
			childId: "c",
		});
		expect(() => parseTraceParams({ sessionId: "s", childId: 3 })).toThrow();
		expect(parseErrorDetailParams({ sessionId: "s", chain: 2 })).toEqual({
			sessionId: "s",
			chain: 2,
		});
		expect(() => parseErrorDetailParams({ sessionId: "s", chain: -1 })).toThrow();
		expect(() => parseErrorDetailParams({ sessionId: "s", chain: "1" })).toThrow();
		expect(parseSubagentParams({ sessionId: "s", childId: "c" })).toEqual({
			sessionId: "s",
			childId: "c",
		});
		expect(() => parseSubagentParams({ sessionId: "s" })).toThrow();
	});
});

test("the analysis is deterministic", async () => {
	const first = buildSessionAnalysis((await traceOf(planSession())).trace, ["b", "a"]);
	const second = buildSessionAnalysis((await traceOf(planSession())).trace, ["a", "b"]);
	expect(JSON.stringify({ ...second, revision: "" })).toBe(
		JSON.stringify({ ...first, revision: "" }),
	);
	expect(first.transcripts).toEqual(["a", "b"]);
});
