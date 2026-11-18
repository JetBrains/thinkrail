import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { runDetails, TranscriptBuilder, tempDir, usage, writeSession } from "../test/builders.ts";
import {
	CONTAINED_PIN,
	CONTAINED_SECRET_CALLS,
	CONTAINED_SECRETS,
	SECRET_ARGS,
	SECRET_CALLS,
	sessionOf,
} from "../test/calls.ts";
import { diagnostics, keyLeaks, rsa4096Key } from "../test/pem.ts";
import { LARGE_TEST_MS, withinBudget } from "../test/perf.ts";
import { buildSessionAnalysis } from "./analysis.ts";
import type { LlmEvent, SubagentEvent, ToolEvent, TraceEvent } from "./core.ts";
import { TRACE_GAP_MIN_MS } from "./core.ts";
import { createRedactor } from "./redact.ts";
import { argumentLabel } from "./trace.ts";
import {
	parseEventParams,
	parseSearchParams,
	parseTraceParams,
	tracePage,
} from "./traceQueries.ts";
import { TraceStore } from "./traceStore.ts";

const root = tempDir("trace");
afterAll(() => rmSync(root, { recursive: true, force: true }));

const HOME = "/home/alice";
const T0 = Date.parse("2026-11-01T10:00:00.000Z");

function store(): TraceStore {
	return new TraceStore({ redactor: createRedactor(HOME), sliceMs: 1000 });
}

function byKind<K extends TraceEvent["kind"]>(
	events: readonly TraceEvent[],
	kind: K,
): Extract<TraceEvent, { kind: K }>[] {
	return events.filter((event): event is Extract<TraceEvent, { kind: K }> => event.kind === kind);
}

function mainSession(name: string) {
	const builder = new TranscriptBuilder({ id: `main-${name}`, start: T0 });
	const prompt = builder.user("Fix the flaky test in /home/alice/repo");
	const requestedAt = builder.now() + 500;
	const llm = builder.assistant({
		thinking: [{ thinking: "Plan: run the test" }, { signature: "sig" }],
		toolCalls: [
			{ id: "c-bash", name: "bash", arguments: { command: "cd x && bun test retry.test.ts" } },
			{ id: "c-read", name: "read", arguments: { path: "/home/alice/repo/a.ts" } },
		],
		requestedAt,
		durationMs: 4000,
		stepMs: 5000,
		usage: usage(100, 0.25),
	});
	const failed = builder.toolResult({
		toolCallId: "c-bash",
		toolName: "bash",
		text: `boom GITHUB_TOKEN=abc\n${"line\n".repeat(5000)}Command exited with code 2`,
		isError: true,
		durationMs: 1500,
		stepMs: 2000,
	});
	builder.toolResult({ toolCallId: "c-read", toolName: "read", text: "export {}", stepMs: 100 });
	const reply = builder.assistant({ text: "Fixed it.\nDetails follow.", stepMs: 3000 });
	return { builder, ids: { prompt, llm, failed, reply } };
}

describe("the trace skeleton", () => {
	test("turns, calls and tools arrive in pre-order with timings, labels and flags", async () => {
		const { builder, ids } = mainSession("basic");
		const file = writeSession(root, "basic", builder);
		const trace = await store().trace(file);
		if (!trace) throw new Error("no trace");
		expect(trace.events.map((event) => [event.kind, event.depth, event.parent])).toEqual([
			["turn", 0, null],
			["llm", 1, ids.prompt],
			["tool", 2, ids.llm],
			["tool", 2, ids.llm],
			["llm", 1, ids.prompt],
		]);
		const [turn, llm, bash, read, reply] = trace.events as [
			TraceEvent,
			LlmEvent,
			ToolEvent,
			ToolEvent,
			LlmEvent,
		];
		expect(turn.label).toBe("Fix the flaky test in ~/repo");
		expect(turn.t1).toBe(reply.t1);
		expect(llm).toMatchObject({
			timing: "recorded",
			t1: llm.t0 + 4000,
			model: "anthropic/claude-test",
			thinking: "plain",
			calls: 2,
			cost: 0.25,
		});
		expect(llm.tokens.total).toBe(406);
		expect(bash).toMatchObject({
			id: `tool:${ids.llm}:0`,
			tool: "bash",
			family: "execution",
			head: "bun test",
			exit: "2",
			error: true,
			timing: "recorded",
			label: "cd x && bun test retry.test.ts",
			toolCallId: "c-bash",
		});
		expect(bash.t1 - bash.t0).toBe(1500);
		expect(read).toMatchObject({ family: "reading", label: "~/repo/a.ts", timing: "approximated" });
		expect(read.error).toBeUndefined();
		expect(reply).toMatchObject({ label: "Fixed it.", timing: "approximated", thinking: "none" });
		expect(trace.meta).toMatchObject({ total: 5, errors: 1, offBranch: 0, gaps: [] });
	});

	test("a call without a result is a missing point; a timestamp-less span is not measured", async () => {
		const builder = new TranscriptBuilder({ id: "missing", start: T0 });
		builder.user("go");
		builder.assistant({
			toolCalls: [{ id: "lost", name: "grep", arguments: { pattern: "TODO" } }],
		});
		const file = writeSession(root, "missing", builder);
		const trace = await store().trace(file);
		const [tool] = byKind(trace?.events ?? [], "tool");
		expect(tool).toMatchObject({
			missing: true,
			resultChars: null,
			timing: "notMeasured",
			family: "discovery",
		});
		expect(tool?.t1).toBe(tool?.t0);
	});

	test("an Agent call carries its subagent; a background run ends at its completion message", async () => {
		const builder = new TranscriptBuilder({ id: "agents", start: T0 });
		builder.user("delegate");
		builder.assistant({
			toolCalls: [
				{
					id: "a1",
					name: "Agent",
					arguments: { subagent_type: "scout", task: "Map the repo\nThen report" },
				},
				{
					id: "a2",
					name: "Agent",
					arguments: { subagent_type: "worker", task: "Fix it", run_in_background: true },
				},
			],
		});
		builder.toolResult({
			toolCallId: "a1",
			toolName: "Agent",
			details: runDetails("kid-1", "completed", { tokens: 10, cost: 0.2 }, 30_000),
			durationMs: 30_000,
		});
		builder.toolResult({
			toolCallId: "a2",
			toolName: "Agent",
			details: { ...runDetails("kid-2", "running", { tokens: 0, cost: 0 }), status: "running" },
		});
		builder.advance(120_000);
		const done = builder.customMessage(
			"subagent-completion",
			runDetails("kid-2", "failed", { tokens: 5, cost: 0.1 }, 90_000),
			"Subagent failed",
		);
		const file = writeSession(root, "agents", builder);
		const trace = await store().trace(file);
		const subagents = byKind(trace?.events ?? [], "subagent");
		expect(
			subagents.map((event) => [event.childId, event.role, event.status, event.depth]),
		).toEqual([
			["kid-1", "scout", "completed", 3],
			["kid-2", "worker", "failed", 3],
		]);
		const [scout, worker] = subagents as [SubagentEvent, SubagentEvent];
		expect(scout).toMatchObject({ label: "Map the repo Then report", tokens: 46, cost: 0.2 });
		expect(scout.t1 - scout.t0).toBe(30_000);
		expect(worker).toMatchObject({ background: true, error: true, tokens: 26, cost: 0.1 });
		const completion = trace?.events.find((event) => event.id === done);
		expect(worker.t1).toBe(completion?.t0 ?? -1);
	});

	test("only the active branch is shown and idle stretches carry their cause", async () => {
		const builder = new TranscriptBuilder({ id: "branchy", start: T0 });
		const first = builder.user("one");
		builder.assistant({ text: "abandoned" });
		builder.branchFrom(first);
		builder.assistant({ text: "kept", durationMs: 1000 });
		builder.advance(10 * 60_000);
		builder.user("two");
		builder.assistant({ text: "ok", durationMs: 1000 });
		const file = writeSession(root, "branchy", builder);
		const trace = await store().trace(file);
		expect(trace?.events.map((event) => event.label)).toEqual(["one", "kept", "two", "ok"]);
		expect(trace?.meta.offBranch).toBe(1);
		expect(trace?.meta.gaps).toHaveLength(1);
		const [gap] = trace?.meta.gaps ?? [];
		expect(gap?.cause).toBe("user");
		expect((gap?.t1 ?? 0) - (gap?.t0 ?? 0)).toBeGreaterThanOrEqual(TRACE_GAP_MIN_MS);
	});

	test("pages concatenate to the whole trace and never split a parent from what precedes it", async () => {
		const builder = new TranscriptBuilder({ id: "paged", start: T0 });
		for (let turn = 0; turn < 30; turn += 1) {
			builder.user(`turn ${turn}`);
			const calls = Array.from({ length: 3 }, (_, index) => ({
				id: `c${turn}-${index}`,
				name: "read",
				arguments: { path: `f${index}` },
			}));
			builder.assistant({ toolCalls: calls });
			for (const call of calls) builder.toolResult({ toolCallId: call.id, toolName: "read" });
		}
		const file = writeSession(root, "paged", builder);
		const trace = (await store().trace(file)) ?? null;
		const seen = new Set<string>();
		const all: TraceEvent[] = [];
		let cursor: number | null = 0;
		while (cursor !== null) {
			const page = tracePage(trace, { sessionId: "paged", cursor, limit: 7 });
			expect(page.events.length).toBeLessThanOrEqual(7);
			for (const event of page.events) {
				if (event.parent !== null) expect(seen.has(event.parent)).toBe(true);
				seen.add(event.id);
			}
			all.push(...page.events);
			cursor = page.next;
		}
		expect(all).toEqual([...(trace?.events ?? [])]);
		expect(tracePage(null, { sessionId: "x" })).toMatchObject({
			found: false,
			pending: false,
			events: [],
		});
		expect(tracePage(null, { sessionId: "x" }, { pending: true }).pending).toBe(true);
	});

	test("the same file builds byte-identical traces", async () => {
		const { builder } = mainSession("determinism");
		const file = writeSession(root, "determinism", builder);
		const first = JSON.stringify(await store().trace(file));
		const second = JSON.stringify(await store().trace(file));
		expect(second).toBe(first);
	});
});

describe("event bodies", () => {
	test("are re-read by byte offset, redacted and capped with their original sizes", async () => {
		const { builder, ids } = mainSession("bodies");
		const file = writeSession(root, "bodies", builder);
		const traces = store();
		const turn = await traces.event(file, ids.prompt);
		expect(turn?.body.prompt).toEqual({ text: "Fix the flaky test in ~/repo", chars: 38 });
		expect(await traces.locate(file, ids.prompt)).toEqual({
			anchorEntryId: ids.prompt,
			toolCallId: null,
		});

		const llm = await traces.event(file, ids.llm);
		expect(llm?.body).toMatchObject({
			thinking: { text: "Plan: run the test" },
			encryptedThinking: 1,
			model: "anthropic/claude-test",
			usage: { input: 100, output: 101, cacheRead: 102, cacheWrite: 103, context: 305, cost: 0.25 },
			issued: [
				{ toolCallId: "c-bash", name: "bash", eventId: `tool:${ids.llm}:0` },
				{ toolCallId: "c-read", name: "read", eventId: `tool:${ids.llm}:1` },
			],
		});

		const bash = await traces.event(file, `tool:${ids.llm}:0`);
		expect(await traces.locate(file, `tool:${ids.llm}:0`)).toEqual({
			anchorEntryId: ids.llm,
			toolCallId: "c-bash",
		});
		expect(await traces.locate(file, "nope")).toBeNull();
		expect(bash?.body.input?.value).toEqual({ command: "cd x && bun test retry.test.ts" });
		const result = bash?.body.result;
		expect(result?.text.startsWith("boom GITHUB_TOKEN=[redacted]\n")).toBe(true);
		expect(result?.text.endsWith("Command exited with code 2")).toBe(true);
		expect(result?.chars).toBe(25_048);
		expect(result?.cut?.lines).toBeGreaterThan(1000);
		expect(bash?.body.error?.cut).toBeDefined();
		expect(bash?.body.raw).toHaveLength(2);

		const read = await traces.event(file, `tool:${ids.llm}:1`);
		expect(read?.body.input?.value).toEqual({ path: "~/repo/a.ts" });
		expect(read?.body.result).toEqual({ text: "export {}", chars: 9 });
		expect(read?.body.error).toBeUndefined();
		expect(await traces.event(file, "nope")).toBeNull();
	});

	test("a key after a long prefix, cut by the result's head and tail, is masked in every body", async () => {
		const key = rsa4096Key();
		const builder = new TranscriptBuilder({ id: "key-body", cwd: `${HOME}/repo`, start: T0 });
		builder.user("Check the deploy key");
		const llm = builder.assistant({
			text: `${"Reading it. ".repeat(2000)}\n${key.block}`,
			toolCalls: [
				{ id: "k1", name: "bash", arguments: { command: "./diagnose.sh && cat deploy.pem" } },
				{ id: "k2", name: "bash", arguments: { command: "./diagnose.sh --big" } },
			],
		});
		const shapes = [
			`${diagnostics(20_000)}${key.block}\n${diagnostics(3_000)}`,
			`${diagnostics(5_000_000)}${key.block}\n${diagnostics(3_000)}`,
		] as const;
		builder.toolResult({ toolCallId: "k1", toolName: "bash", text: shapes[0], isError: true });
		builder.toolResult({ toolCallId: "k2", toolName: "bash", text: shapes[1] });
		const file = writeSession(root, "key-body", builder);
		const traces = store();
		for (const [index, text] of shapes.entries()) {
			const started = performance.now();
			const loaded = await traces.event(file, `tool:${llm}:${index}`);
			const ms = performance.now() - started;
			const body = JSON.stringify(loaded?.body);
			expect(loaded?.body.result?.chars).toBe(text.length);
			expect(loaded?.body.result?.cut).toBeDefined();
			expect(keyLeaks(body, key)).toEqual([]);
			expect(body).not.toContain("END RSA PRIVATE KEY");
			if (index === 1) withinBudget(ms, 150);
		}
		const reply = await traces.event(file, llm);
		expect(keyLeaks(JSON.stringify(reply?.body), key)).toEqual([]);
	});

	test("a bash command's head is taken from the masked command", async () => {
		const builder = new TranscriptBuilder({ id: "key-head", start: T0 });
		builder.user("Log in");
		builder.assistant({
			toolCalls: [
				{
					id: "h1",
					name: "bash",
					arguments: { command: "ghp_abcdefghijklmnopqrstuvwxyz0123 | gh auth login" },
				},
				{ id: "h2", name: "bash", arguments: { command: "/home/alice/bin/deploy --all" } },
			],
		});
		builder.toolResult({ toolCallId: "h1", toolName: "bash", text: "ok" });
		builder.toolResult({ toolCallId: "h2", toolName: "bash", text: "ok" });
		const trace = await store().trace(writeSession(root, "key-head", builder));
		expect(byKind(trace?.events ?? [], "tool").map((event) => event.head)).toEqual([
			"[redacted]",
			"deploy",
		]);
	});

	test("a file rewritten in place is re-indexed before a body is read", async () => {
		const { builder, ids } = mainSession("stale");
		const file = writeSession(root, "stale", builder);
		const pinned = new Date(T0);
		utimesSync(file, pinned, pinned);
		const traces = store();
		await traces.trace(file);
		const original = readFileSync(file, "utf8");
		const lines = original.trimEnd().split("\n");
		const [header, user, ...rest] = lines;
		const swapped = `${[header, ...rest.slice(0, 1), user, ...rest.slice(1)].join("\n")}\n`;
		expect(swapped.length).toBe(original.length);
		writeFileSync(file, swapped);
		utimesSync(file, pinned, pinned);
		expect(statSync(file).mtimeMs).toBe(T0);
		const turn = await traces.event(file, ids.prompt);
		expect(turn?.body.prompt?.text).toBe("Fix the flaky test in ~/repo");
	});
});

describe("labels of tools without a label rule", () => {
	test("never take a value from under a secret-named argument", async () => {
		const file = writeSession(
			root,
			"secret-args",
			sessionOf("secret-args", [{ prompt: "Connect", calls: SECRET_CALLS }]),
		);
		const traces = store();
		const trace = await traces.trace(file);
		if (!trace) throw new Error("no trace");
		const labels = byKind(trace.events, "tool").map((event) => [event.tool, event.label]);
		expect(labels).toEqual([
			["db_connect", "db.local"],
			["db_connect", "db.local"],
			["deploy_service", ""],
			["set_env", ""],
			["configure", "staging"],
		]);
		const skeleton = JSON.stringify(trace.events);
		for (const value of Object.values(SECRET_ARGS)) {
			expect(skeleton).not.toContain(value);
			expect((await traces.search(file, value, 100))?.ids).toEqual([]);
		}
		expect(
			argumentLabel("custom", { token: "abc", secret: "def", client_secret: "ghi", name: "x" }),
		).toBe("x");
	});

	test("never show a value from inside a secret-named container: labels, event.get and trace search", async () => {
		const file = writeSession(
			root,
			"contained-secrets",
			sessionOf("contained-secrets", [{ prompt: "Rotate", calls: CONTAINED_SECRET_CALLS }]),
		);
		const traces = store();
		const trace = await traces.trace(file);
		if (!trace) throw new Error("no trace");
		const tools = byKind(trace.events, "tool");
		expect(tools.map((event) => [event.tool, event.label])).toEqual([
			["vault_write", "kv/app"],
			["vault_write", "kv/app"],
			["rotate_key", "rotation"],
			["store_secrets", ""],
			["http_call", "https://api.example.test/v1"],
		]);
		const bodies = await Promise.all(tools.map((event) => traces.event(file, event.id)));
		expect(bodies.map((loaded) => loaded?.body.input?.value)).toEqual([
			{ path: "kv/app", credentials: { value: "[redacted]", pin: "[redacted]" } },
			{ path: "kv/app", credentials: { value: "[redacted]", pin: "[redacted]" } },
			{ apiKey: { current: "[redacted]", previous: "[redacted]" }, note: "rotation" },
			{ secrets: ["[redacted]", "[redacted]"] },
			{ url: "https://api.example.test/v1", auth: { headers: { x: "[redacted]" } } },
		]);
		expect(bodies[4]?.body.details?.value).toEqual({
			request: { auth: { headers: { x: "[redacted]" } } },
			credentials: { value: "[redacted]", rotated: "[redacted]" },
		});
		const shown = JSON.stringify([trace.events, bodies]);
		for (const value of Object.values(CONTAINED_SECRETS)) {
			expect(shown).not.toContain(value);
			expect((await traces.search(file, value, 100))?.ids).toEqual([]);
		}
		expect(shown).not.toContain(String(CONTAINED_PIN));
		expect((await traces.search(file, String(CONTAINED_PIN), 100))?.ids).toEqual([]);
	});
});

describe("trace search", () => {
	test("matches bodies, arguments and labels case-insensitively, in trace order", async () => {
		const { builder, ids } = mainSession("search");
		const file = writeSession(root, "search", builder);
		const traces = store();
		const ids0 = (await traces.search(file, "RETRY.TEST", 100))?.ids;
		expect(ids0).toEqual([`tool:${ids.llm}:0`]);
		expect((await traces.search(file, "plan: run", 100))?.ids).toEqual([ids.llm]);
		expect((await traces.search(file, "exited with code", 100))?.ids).toEqual([
			`tool:${ids.llm}:0`,
		]);
		expect((await traces.search(file, "claude-test", 1))?.truncated).toBe(true);
	});
});

describe("pinned paging", () => {
	test("later pages come from the first page's revision while the file grows, flagged as superseded", async () => {
		const { builder } = mainSession("pinned");
		const file = writeSession(root, "pinned", builder);
		const traces = store();
		const at = await traces.traceAt(file);
		if (!at) throw new Error("expected a trace");
		const first = tracePage(
			at.trace,
			{ sessionId: "main-pinned", limit: 2 },
			{ newerRevision: at.newerRevision },
		);
		const revision = first.meta?.revision ?? "";
		expect(first.newerRevision).toBe(false);
		builder.user("A prompt written while the client pages");
		builder.assistant({ text: "More." });
		writeSession(root, "pinned", builder);
		utimesSync(file, new Date(T0 + 60_000), new Date(T0 + 60_000));
		const current = await traces.trace(file);
		expect(current?.meta.revision).not.toBe(revision);
		const pinned = await traces.traceAt(file, revision);
		expect(pinned?.trace).toBe(at.trace);
		expect(pinned?.newerRevision).toBe(true);
		const next = tracePage(
			pinned?.trace ?? null,
			{ sessionId: "main-pinned", cursor: first.next ?? 0, limit: 2, revision },
			{ newerRevision: pinned?.newerRevision === true },
		);
		expect(next.meta?.revision).toBe(revision);
		expect(next.newerRevision).toBe(true);
		const unknown = await traces.traceAt(file, "0:0");
		expect(unknown?.trace).toBe(current ?? undefined);
		expect(unknown?.newerRevision).toBe(false);
	});

	test("a file keeps at most two pinned snapshots", async () => {
		const builder = new TranscriptBuilder({ id: "pins", start: T0 });
		builder.user("go");
		const file = writeSession(root, "pins", builder);
		const traces = store();
		const revisions: string[] = [];
		for (let step = 0; step < 3; step += 1) {
			builder.assistant({ text: `step ${step}` });
			writeSession(root, "pins", builder);
			utimesSync(file, new Date(T0 + step * 1000), new Date(T0 + step * 1000));
			revisions.push((await traces.traceAt(file))?.trace.meta.revision ?? "");
		}
		expect(new Set(revisions).size).toBe(3);
		expect((await traces.traceAt(file, revisions[0]))?.trace.meta.revision).toBe(revisions[2]);
		expect((await traces.traceAt(file, revisions[1]))?.trace.meta.revision).toBe(revisions[1]);
	});
});

describe("params", () => {
	test("reject malformed requests before any file is read", () => {
		expect(parseTraceParams({ sessionId: "s", cursor: 4, limit: 10 })).toEqual({
			sessionId: "s",
			cursor: 4,
			limit: 10,
		});
		expect(parseTraceParams({ sessionId: "s", revision: "12:34" })).toEqual({
			sessionId: "s",
			revision: "12:34",
		});
		expect(() => parseTraceParams({ sessionId: "s", revision: "" })).toThrow();
		expect(() => parseTraceParams({ sessionId: "s", revision: 3 })).toThrow();
		expect(() => parseTraceParams({ sessionId: "s", cursor: -1 })).toThrow();
		expect(() => parseTraceParams({ sessionId: "s", limit: 0 })).toThrow();
		expect(() => parseTraceParams({ sessionId: "" })).toThrow();
		expect(parseEventParams({ sessionId: "s", eventId: "e" })).toEqual({
			sessionId: "s",
			eventId: "e",
		});
		expect(() => parseEventParams({ sessionId: "s" })).toThrow();
		expect(parseSearchParams({ sessionId: "s", query: "  ab " })).toEqual({
			sessionId: "s",
			query: "ab",
		});
		expect(() => parseSearchParams({ sessionId: "s", query: "a" })).toThrow();
	});
});

describe("budgets", () => {
	test(
		"a 2,400-call session builds and pages within the first-page budget",
		async () => {
			const builder = new TranscriptBuilder({ id: "large", start: T0 });
			for (let turn = 0; turn < 120; turn += 1) {
				builder.user(`turn ${turn} ${"context ".repeat(40)}`);
				for (let call = 0; call < 10; call += 1) {
					const calls = [0, 1].map((index) => ({
						id: `c${turn}-${call}-${index}`,
						name: index ? "read" : "bash",
						arguments: index ? { path: `src/file${call}.ts` } : { command: `bun test ${call}` },
					}));
					builder.assistant({ text: "Working on it.", toolCalls: calls, durationMs: 800 });
					for (const item of calls)
						builder.toolResult({
							toolCallId: item.id,
							toolName: item.name,
							text: "x".repeat(2000),
							durationMs: 200,
						});
				}
			}
			const file = writeSession(root, "large", builder);
			const started = performance.now();
			const trace = await store().trace(file);
			const page = tracePage(trace, { sessionId: "large" });
			const elapsed = performance.now() - started;
			expect(trace?.events.filter((event) => event.kind === "tool")).toHaveLength(2400);
			expect(JSON.stringify(page).length).toBeLessThan(1_000_000);
			withinBudget(elapsed, 1500);
			if (!trace) throw new Error("no trace");
			const analysed = performance.now();
			const analysis = buildSessionAnalysis(trace, []);
			withinBudget(performance.now() - analysed, 300);
			expect(JSON.stringify(analysis).length).toBeLessThan(1_000_000);
		},
		LARGE_TEST_MS,
	);
});
