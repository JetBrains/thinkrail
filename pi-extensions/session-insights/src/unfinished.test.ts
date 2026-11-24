import { afterAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { TranscriptBuilder, tempDir, writeSession } from "../test/builders.ts";
import { statsOver } from "../test/stats.ts";
import { buildErrorDetail, buildSessionAnalysis } from "./analysis.ts";
import { statsScope } from "./crossSession.ts";
import { digestOf } from "./digest.ts";
import { buildFileDetail, buildSessionFiles } from "./files.ts";
import { buildFindings } from "./findings.ts";
import { analyseFriction } from "./friction.ts";
import {
	InsightsEngine,
	parseInsightsArgs,
	runInsights,
	vanillaInsightsLocations,
} from "./insightsCommand.ts";
import { createRedactor } from "./redact.ts";
import { buildSequences } from "./sequences.ts";
import { TraceStore } from "./traceStore.ts";
import { buildStatsUsage } from "./usage.ts";

const root = tempDir("unfinished");
afterAll(() => rmSync(root, { recursive: true, force: true }));

const READY = { phase: "ready", indexed: 0, total: 0 } as const;
const day = (date: number, hour = 10) => new Date(2026, 10, date, hour).getTime();
const SKILL = "/home/me/.pi/skills/review/SKILL.md";

function skillsSection(names: readonly string[]): string {
	return `<skills>\n<available_skills>\n${names
		.map(
			(name) =>
				`  <skill>\n    <name>${name}</name>\n    <description>Use ${name}.</description>\n    <location>/home/me/.pi/skills/${name}/SKILL.md</location>\n  </skill>`,
		)
		.join("\n")}\n</available_skills>\n</skills>`;
}

/**
 * The reviewer's scenario: an assistant reply stopped after it emitted a `SKILL.md` read and a write,
 * before either ran — pi 1.5.2 persists the reply with its tool calls and no results — then a reply
 * that says the tests pass. The file was read once, in an earlier turn that finished.
 */
function stopped(id: string, date = 1): TranscriptBuilder {
	const builder = new TranscriptBuilder({ id, cwd: "/work/a", start: day(date) });
	builder.system({ sections: { skills: skillsSection(["review"]) } });
	builder.user("Read the parser first");
	builder.assistant({
		toolCalls: [{ id: "r0", name: "read", arguments: { path: "src/parser.ts" } }],
	});
	builder.toolResult({ toolCallId: "r0", toolName: "read", text: "export {};\n" });
	builder.assistant({ text: "Read it." });
	builder.user("Review it and fix the parser");
	builder.assistant({
		toolCalls: [
			{ id: "s1", name: "read", arguments: { path: SKILL } },
			{ id: "w1", name: "write", arguments: { path: "src/parser.ts", content: "a\nb\nc\n" } },
		],
		stopReason: "aborted",
	});
	builder.user("Where are we?");
	builder.assistant({ text: "All tests pass now." });
	return builder;
}

/** A failed test run whose retry was emitted and stopped before it ran: the chain ends in a call without a result. */
function retryStopped(id: string): TranscriptBuilder {
	const builder = new TranscriptBuilder({ id, cwd: "/work/a", start: day(2) });
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
	return builder;
}

async function loaded(name: string, builder: TranscriptBuilder) {
	const store = new TraceStore({ sliceMs: 1000, redactor: createRedactor("/home/me") });
	const file = writeSession(root, name, builder);
	const trace = await store.trace(file);
	if (!trace) throw new Error("no trace");
	return { store, file, trace };
}

describe("a call without a recorded result never ran", () => {
	test("the digest counts no skill load, no file touch and no edit before a claim", async () => {
		const { trace, file } = await loaded("digest", stopped("stopped-digest"));
		const index = await statsOver([file]);
		const summary = index.index.summaries().find((entry) => entry.file === file);
		if (!summary) throw new Error("no summary");
		const digest = digestOf(trace, summary);
		expect([...digest.loads.keys()]).toEqual([]);
		expect([...digest.files]).toEqual([
			[
				"src/parser.ts",
				{
					reads: 1,
					edits: 0,
					writes: 0,
					failed: 0,
					added: 0,
					removed: 0,
					events: [],
					last: expect.any(Number),
				},
			],
		]);
		expect(digest.outsideTouches).toBe(0);
		expect(digest.unverified).toEqual([]);
		expect(digest.tools.get("write")).toMatchObject({ calls: 1, errors: 0, notRun: 1 });
		expect(digest.tools.get("read")).toMatchObject({ calls: 2, errors: 0, notRun: 1 });
		expect(digest.steps.map((step) => [step.tool, step.failed, step.missing])).toEqual([
			["read", false, false],
			["read", false, true],
			["write", false, true],
		]);
		expect(buildSessionAnalysis(trace, []).skills).toEqual([]);
	});

	test("usage and findings: the skill reads as never loaded, the calls as not run", async () => {
		const files = [
			writeSession(root, "usage-1", stopped("stopped-u1", 1)),
			writeSession(root, "usage-2", stopped("stopped-u2", 2)),
		];
		const { input } = await statsOver(files);
		const { usage } = await buildStatsUsage(input, READY);
		expect(usage.skills.find((row) => row.name === "review")).toMatchObject({
			loads: { value: 0 },
			neverLoaded: true,
		});
		const write = usage.tools.find((row) => row.name === "write");
		expect(write).toMatchObject({ calls: { value: 2 }, errors: { value: 0 }, notRun: 2 });
		expect(write?.errorRate).toBeNull();
		expect(usage.tools.find((row) => row.name === "read")?.errorRate).toMatchObject({ k: 0, n: 2 });

		const scope = await statsScope(input, READY);
		const findings = await buildFindings(input, scope.ready, new Set(), createRedactor("/home/me"));
		expect(findings.find((finding) => finding.rule === "skillNeverLoaded")?.names).toEqual([
			"review",
		]);
		expect(findings.filter((finding) => finding.rule === "unverifiedClaim")).toEqual([]);
	});

	test("a test run without a result verifies nothing: a later claim is done without verification", async () => {
		const claim = (id: string, date: number) => {
			const builder = new TranscriptBuilder({ id, cwd: "/work/a", start: day(date) });
			builder.user("Fix the parser");
			builder.assistant({
				toolCalls: [{ id: "e1", name: "edit", arguments: { path: "src/parser.ts", edits: [] } }],
			});
			builder.toolResult({ toolCallId: "e1", toolName: "edit" });
			builder.assistant({
				toolCalls: [{ id: "t1", name: "bash", arguments: { command: "bun test parser" } }],
				stopReason: "aborted",
			});
			builder.user("Done?");
			builder.assistant({ text: "All tests pass now." });
			return writeSession(root, id, builder);
		};
		const { input } = await statsOver([claim("claim-1", 3), claim("claim-2", 4)]);
		const scope = await statsScope(input, READY);
		const findings = await buildFindings(input, scope.ready, new Set(), createRedactor("/home/me"));
		expect(findings.find((finding) => finding.rule === "unverifiedClaim")?.count).toBe(2);
	});

	test("the Files view: no change, no lines and no diff; the file's detail lists the write as not run", async () => {
		const { store, file, trace } = await loaded("files", stopped("stopped-files"));
		const files = buildSessionFiles(trace);
		expect(files.cols.map((column) => column.turnN)).toEqual([1]);
		expect(files.rows).toEqual([
			expect.objectContaining({
				path: "src/parser.ts",
				reads: 1,
				edits: 0,
				writes: 0,
				failed: 0,
				added: 0,
				rework: false,
				cells: [[0, 1, 0, 0, 0]],
			}),
		]);
		expect(files.totals).toMatchObject({ files: 1, changed: 0, readOnly: 1, added: 0 });
		const detail = await buildFileDetail(store, file, trace, "src/parser.ts");
		expect(
			detail?.touches.map((touch) => [
				touch.op,
				touch.failed,
				touch.missing ?? false,
				touch.column,
				touch.added,
			]),
		).toEqual([
			["read", false, false, 0, 0],
			["write", false, true, null, 0],
		]);
		expect(detail?.diffs).toEqual([]);
		expect(detail?.moreDiffs).toBe(0);
		expect(await buildFileDetail(store, file, trace, "~/.pi/skills/review/SKILL.md")).toBeNull();
	});

	test("a recovery chain that ends in a call without a result is unfinished, never recovered", async () => {
		const { store, file, trace } = await loaded("chain", retryStopped("retry-stopped"));
		const friction = analyseFriction(trace);
		const chains = friction.chains.filter((chain) => chain.kind === "tool");
		expect(chains).toHaveLength(1);
		expect(chains[0]).toMatchObject({
			kind: "tool",
			name: "bash",
			outcome: "unfinished",
			recoveredIn: { value: null },
		});
		expect(friction.toolRecovery).toEqual([
			{
				tool: "bash",
				failures: 1,
				chains: 1,
				recovered: 0,
				changedApproach: 0,
				gaveUp: 0,
				unfinished: 1,
			},
		]);
		const detail = await buildErrorDetail(store, file, trace, chains[0]?.index ?? -1);
		expect(detail?.attempts.map((attempt) => [attempt.failed, attempt.missing ?? false])).toEqual([
			[true, false],
			[false, true],
		]);

		const { input } = await statsOver([file]);
		const scope = await statsScope(input, READY);
		const digest = scope.ready[0]?.digest;
		expect(digest?.recovery.get("bash")).toBeUndefined();
		const flow = buildSequences(scope.ready).flow;
		expect(flow.failing[0]?.outcomes.recovered).toBe(0);
		expect(flow.columns[1]?.map((node) => node.key)).toEqual(["notRun"]);
		expect(flow.example).toBeNull();
	});

	test("/insights reports the chain as unfinished", async () => {
		const agentDir = join(root, "agent");
		const builder = retryStopped("019f0000-0000-7000-8000-0000000000aa");
		writeSession(join(agentDir, "sessions"), "--work-a--", builder);
		const parsed = parseInsightsArgs("--session 019f0000-0000-7000-8000-0000000000aa");
		if (!parsed.ok) throw new Error(parsed.message);
		const text = await runInsights(
			new InsightsEngine(vanillaInsightsLocations(agentDir)),
			parsed.request,
			{
				cwd: "/work/a",
				contextWindow: async () => 200_000,
				progressMs: 20,
			},
		);
		expect(text).toContain("1 tool failure in 1 chain: 1 unfinished (the retry got no result)");
		expect(text).not.toContain("1 recovered");
	});
});
