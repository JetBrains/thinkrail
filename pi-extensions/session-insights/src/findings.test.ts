import { afterAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import {
	cached,
	type PiUsage,
	runDetails,
	TranscriptBuilder,
	tempDir,
	writeSession,
} from "../test/builders.ts";
import { statsOver } from "../test/stats.ts";
import { FINDING_RULES, type Finding, type FindingRule } from "./core.ts";
import { statsScope } from "./crossSession.ts";
import {
	buildFindings,
	buildFindingsList,
	parseFindingsHideParams,
	parseHidden,
	setFindingHidden,
} from "./findings.ts";
import { createRedactor } from "./redact.ts";
import { clusterSentences, jaccard, promptSentences } from "./repeats.ts";
import { median, outliers, wilson } from "./stats.ts";
import { JsonStore } from "./store.ts";

const root = tempDir("findings");
afterAll(() => rmSync(root, { recursive: true, force: true }));

const READY = { phase: "ready", indexed: 0, total: 0 } as const;
const day = (date: number, hour = 10) => new Date(2026, 10, date, hour).getTime();

type Step =
	| { prompt: string }
	| { skills: readonly string[] }
	| {
			call: string;
			args?: Record<string, unknown>;
			error?: boolean;
			text?: string;
			details?: unknown;
	  }
	| {
			reply: string;
			usage?: PiUsage;
			provider?: string;
			model?: string;
			stop?: string;
			errorMessage?: string;
	  };

function skillsSection(names: readonly string[]): string {
	return `<skills>\n<available_skills>\n${names
		.map(
			(name) =>
				`  <skill>\n    <name>${name}</name>\n    <description>Use ${name}.</description>\n  </skill>`,
		)
		.join("\n")}\n</available_skills>\n</skills>`;
}

let counter = 0;

function write(
	id: string,
	steps: readonly Step[],
	options: { cwd?: string; date?: number; folder?: string } = {},
): string {
	const builder = new TranscriptBuilder({
		id,
		cwd: options.cwd ?? "/work/a",
		start: day(options.date ?? 1),
	});
	for (const step of steps) {
		if ("prompt" in step) builder.user(step.prompt);
		else if ("skills" in step) builder.system({ sections: { skills: skillsSection(step.skills) } });
		else if ("call" in step) {
			counter += 1;
			const callId = `c${counter}`;
			builder.assistant({
				toolCalls: [{ id: callId, name: step.call, arguments: step.args ?? {} }],
				durationMs: 500,
			});
			builder.toolResult({
				toolCallId: callId,
				toolName: step.call,
				isError: step.error === true,
				text: step.text ?? (step.error ? "Error: failed\nCommand exited with code 1" : "ok"),
				...(step.details !== undefined ? { details: step.details } : {}),
			});
		} else
			builder.assistant({
				text: step.reply,
				...(step.usage ? { usage: step.usage } : {}),
				...(step.provider ? { provider: step.provider } : {}),
				...(step.model ? { model: step.model } : {}),
				...(step.stop ? { stopReason: step.stop } : {}),
				...(step.errorMessage ? { errorMessage: step.errorMessage } : {}),
			});
	}
	return writeSession(root, options.folder ?? id, builder);
}

const bash = (command: string, error = false, text?: string): Step => ({
	call: "bash",
	args: { command },
	error,
	...(text ? { text } : {}),
});

async function findingsOf(
	files: readonly string[],
	contextWindow: (provider: string, model: string) => Promise<number | null> = async () => 200_000,
): Promise<Finding[]> {
	const { input } = await statsOver(files, { contextWindow });
	const scope = await statsScope(input, READY);
	return buildFindings(input, scope.ready, new Set(), createRedactor("/home/me"));
}

function ofRule(findings: readonly Finding[], rule: FindingRule): Finding[] {
	return findings.filter((finding) => finding.rule === rule);
}

describe("statistics helpers", () => {
	test("Wilson intervals match the score formula", () => {
		const rate = wilson(27, 154);
		expect(rate?.low).toBeCloseTo(0.1232, 3);
		expect(rate?.high).toBeCloseTo(0.2431, 3);
		expect(wilson(0, 10)?.low).toBe(0);
		expect(wilson(10, 10)?.high).toBe(1);
		expect(wilson(0, 0)).toBeNull();
	});

	test("medians and outliers above three times the median", () => {
		expect(median([3, 1, 2])).toBe(2);
		expect(median([1, 2, 3, 10])).toBe(2.5);
		expect(median([])).toBeNull();
		const found = outliers([1, 1, 1, 1, 1, 3.1, 0], (value) => value, 3, 5);
		expect(found).toEqual({ median: 1, items: [3.1] });
		expect(outliers([1, 1, 1, 10], (value) => value, 3, 5)).toBeNull();
		expect(outliers([1, 1, 1, 1, 3], (value) => value, 3, 5)?.items).toEqual([]);
	});

	test("shingled prompt sentences cluster near-verbatim repeats across sessions", () => {
		const redactor = createRedactor("/home/me");
		const [a] = promptSentences("Please run the full test suite before you finish.", redactor, 6);
		const [b] = promptSentences("please run the full test suite before you finish!!", redactor, 6);
		const [c] = promptSentences("Please run the whole test suite before you finish.", redactor, 6);
		expect(promptSentences("Too short to count.", redactor, 6)).toEqual([]);
		expect(
			promptSentences("```\nrun the full test suite before you finish now\n```", redactor, 6),
		).toEqual([]);
		if (!a || !b || !c) throw new Error("no sentences");
		expect(jaccard(a.shingles, b.shingles)).toBe(1);
		expect(jaccard(a.shingles, c.shingles)).toBeCloseTo(0.4, 5);
		const items = [
			{ session: 0, eventId: "e0", sentence: a },
			{ session: 1, eventId: "e1", sentence: b },
			{ session: 1, eventId: "e2", sentence: b },
			{ session: 2, eventId: "e3", sentence: c },
		];
		expect(clusterSentences(items, 0.6, 2)).toEqual([{ members: [0, 1, 2], sessions: [0, 1] }]);
		expect(clusterSentences(items, 0.6, 3)).toEqual([]);
		expect(clusterSentences(items, 0.4, 3)).toEqual([
			{ members: [0, 1, 2, 3], sessions: [0, 1, 2] },
		]);
	});
});

describe("skills", () => {
	test("listed but never loaded, with the per-request tokens of their entries; loaded without being listed", async () => {
		const findings = await findingsOf([
			write("sk1", [
				{ skills: ["review", "deploy", "unused"] },
				{ prompt: "go" },
				{ call: "read", args: { path: "/home/me/.pi/skills/review/SKILL.md" } },
				{ call: "read", args: { path: "/home/me/.pi/skills/ghost/SKILL.md" } },
			]),
			write("sk2", [{ prompt: "/skill:deploy now" }, { reply: "ok" }]),
			write("sk3", [
				{ prompt: "go" },
				{ call: "read", args: { path: "/home/me/.pi/skills/elsewhere/SKILL.md" } },
			]),
		]);
		const [never] = ofRule(findings, "skillNeverLoaded");
		expect(never?.names).toEqual(["unused"]);
		expect(never?.count).toBe(1);
		expect(never?.total).toBe(1);
		expect(never?.figures.perRequest?.origin).toBe("approximated");
		expect(never?.figures.perRequest?.value).toBeGreaterThan(10);
		const [unlisted] = ofRule(findings, "skillUnlisted");
		expect(unlisted?.names).toEqual(["ghost"]);
		expect(unlisted?.links[0]?.events).toHaveLength(1);
	});

	test("say nothing about skills when no session persisted a skills list", async () => {
		const findings = await findingsOf([
			write("sk4", [{ prompt: "go" }, { call: "read", args: { path: "/x/ghost/SKILL.md" } }]),
		]);
		expect(ofRule(findings, "skillNeverLoaded")).toEqual([]);
		expect(ofRule(findings, "skillUnlisted")).toEqual([]);
	});
});

describe("commands and tools", () => {
	test("a command failing ≥3 times, in ≥8 % of runs, in ≥2 sessions, with what worked after a failure", async () => {
		const ok = (count: number, command: string) =>
			Array.from({ length: count }, () => bash(command));
		const findings = await findingsOf([
			write("c1", [
				{ prompt: "go" },
				bash(
					"bun test",
					true,
					"error: expect(received).toBe(expected)\nCommand exited with code 1",
				),
				bash("cd pkg && bun test"),
				bash(
					"bun test",
					true,
					"error: expect(received).toBe(expected)\nCommand exited with code 1",
				),
				...ok(3, "bun test"),
				bash("npm run lint", true),
				bash("npm run lint", true),
				bash("npm run lint", true),
				bash("make", true),
				bash("git status", true),
				bash("git status", true),
				...ok(20, "git status"),
			]),
			write("c2", [
				{ prompt: "go" },
				bash(
					"bun test",
					true,
					"error: expect(received).toBe(expected)\nCommand exited with code 1",
				),
				...ok(3, "bun test"),
				bash("make", true),
				bash("git status", true),
				...ok(15, "git status"),
			]),
		]);
		const failing = ofRule(findings, "commandFailing");
		expect(failing.map((finding) => finding.subject)).toEqual(["bun test"]);
		const [bunTest] = failing;
		expect(bunTest?.count).toBe(3);
		expect(bunTest?.total).toBe(10);
		expect(bunTest?.rate?.low).toBeCloseTo(wilson(3, 10)?.low ?? 0, 6);
		expect(bunTest?.shares).toEqual([{ key: "1", count: 3 }]);
		expect(bunTest?.quote).toEqual({ text: "error: expect(received).toBe(expected)", count: 3 });
		expect(bunTest?.links.map((link) => link.count)).toEqual([2, 1]);
		expect(bunTest?.worked?.segments).toEqual([
			{ op: "added", text: "cd pkg && " },
			{ op: "same", text: "bun test" },
		]);
	});

	test("what worked prefers a session whose successful run changed the arguments", async () => {
		const fail = () => bash("bun x", true, "boom\nCommand exited with code 1");
		const findings = await findingsOf([
			write("w1", [{ prompt: "go" }, fail(), bash("bun x --verbose")], { date: 1 }),
			write("w2", [{ prompt: "go" }, fail(), fail(), bash("bun x")], { date: 2 }),
		]);
		const [command] = ofRule(findings, "commandFailing");
		expect(command?.worked?.session).toBe(1);
		expect(command?.worked?.segments).toEqual([
			{ op: "same", text: "bun x" },
			{ op: "added", text: " --verbose" },
		]);
	});

	test("known exit codes are false errors: gh pr checks exit 8 means checks are pending", async () => {
		const pending = "checks pending\nCommand exited with code 8";
		const findings = await findingsOf([
			write("f1", [
				{ prompt: "go" },
				bash("gh pr checks 12", true, pending),
				bash("gh pr checks 12", true, pending),
				bash("grep -rn needle src", true, "Command exited with code 1"),
			]),
		]);
		const [falseError] = ofRule(findings, "falseError");
		expect(falseError?.id).toBe("falseError:gh pr checks:8");
		expect(falseError?.names).toEqual(["checksPending"]);
		expect(falseError?.count).toBe(2);
		expect(ofRule(findings, "falseError")).toHaveLength(1);
	});

	test("loops of ≥3 identical calls, poor recovery and oversized output", async () => {
		const read = (path: string): Step => ({ call: "read", args: { path } });
		const failedEdit = (path: string): Step => ({
			call: "edit",
			args: { path, edits: [] },
			error: true,
			text: "Could not find the exact text",
		});
		const big = "x".repeat(FINDING_RULES.oversizedChars);
		const findings = await findingsOf([
			write("l1", [
				{ prompt: "go" },
				read("a.ts"),
				read("a.ts"),
				read("a.ts"),
				{ reply: "hm" },
				read("b.ts"),
				read("b.ts"),
				{ reply: "hm" },
				{ prompt: "one" },
				failedEdit("a.ts"),
				{ prompt: "two" },
				failedEdit("b.ts"),
				{ prompt: "three" },
				failedEdit("c.ts"),
				{ call: "read", args: { path: "big.log" }, text: big },
				{ call: "read", args: { path: "big2.log" }, text: big },
			]),
			write("l2", [
				{ prompt: "go" },
				read("c.ts"),
				read("c.ts"),
				read("c.ts"),
				read("c.ts"),
				{ reply: "hm" },
				{ prompt: "one" },
				failedEdit("d.ts"),
				{ prompt: "two" },
				failedEdit("e.ts"),
				{ call: "read", args: { path: "big3.log" }, text: big },
			]),
		]);
		const [loop] = ofRule(findings, "loop");
		expect(loop).toMatchObject({ id: "loop:read", count: 2, ratio: 4 });
		const [recovery] = ofRule(findings, "poorRecovery");
		expect(recovery).toMatchObject({ id: "recovery:edit", count: 0, total: 5, heuristic: true });
		const [oversized] = ofRule(findings, "oversizedOutput");
		expect(oversized?.count).toBe(3);
		expect(oversized?.figures.largestOutput?.value).toBe(FINDING_RULES.oversizedChars);
	});
});

describe("context, cache and cost", () => {
	test("context-limit hits, cache misses with their causes, and subagent spend outside pi's total", async () => {
		const findings = await findingsOf([
			write("x1", [
				{ prompt: "go" },
				{ reply: "warm", usage: cached({ input: 1000, cacheWrite: 20_000 }, 0.1) },
				...Array.from(
					{ length: 6 },
					(): Step => ({
						reply: "miss",
						usage: cached({ input: 21_000, cacheRead: 100 }, 0.1),
					}),
				),
				{
					reply: "",
					stop: "error",
					errorMessage: "prompt is too long: 213000 tokens > 200000 maximum",
					usage: cached({ input: 0 }, 0),
				},
				{
					call: "Agent",
					args: { subagent_type: "scout", task: "look" },
					details: runDetails("kid", "completed", { tokens: 50, cost: 0.4 }),
				},
			]),
		]);
		const [limit] = ofRule(findings, "contextLimit");
		expect(limit?.count).toBe(1);
		expect(limit?.figures.window).toEqual({ value: 200_000, origin: "host" });
		expect(limit?.figures.peak?.value).toBe(21_100);
		const [misses] = ofRule(findings, "cacheMisses");
		expect(misses?.count).toBe(6);
		expect(misses?.heuristic).toBe(true);
		expect(misses?.shares).toEqual([{ key: "none", count: 6 }]);
		const [outside] = ofRule(findings, "subagentsOutside");
		expect(outside?.figures.outside?.value).toBeCloseTo(0.4);
	});

	test("a context-limit hit reports the peak and window of the model that hit it", async () => {
		const windows: Record<string, number> = { "small-200k": 200_000, "large-1m": 1_000_000 };
		const findings = await findingsOf(
			[
				write("limits", [
					{ prompt: "go" },
					{ reply: "a", model: "small-200k", usage: cached({ input: 150_000 }, 0.1) },
					{
						reply: "",
						model: "small-200k",
						stop: "error",
						errorMessage: "prompt is too long: 213000 tokens > 200000 maximum",
						usage: cached({ input: 0 }, 0),
					},
					{ reply: "b", model: "large-1m", usage: cached({ input: 900_000 }, 0.5) },
				]),
			],
			async (_provider, model) => windows[model] ?? null,
		);
		const [limit] = ofRule(findings, "contextLimit");
		expect(limit?.subject).toBe("anthropic/small-200k");
		expect(limit?.figures.peak).toEqual({ value: 150_000, origin: "recorded" });
		expect(limit?.figures.window).toEqual({ value: 200_000, origin: "host" });
	});

	test("sessions over three times the median cost, tokens where cost is not recorded", async () => {
		const priced = (id: string, cost: number) =>
			write(id, [{ prompt: "go" }, { reply: "ok", usage: cached({ input: 100 }, cost) }]);
		const unpriced = (id: string, input: number) =>
			write(id, [
				{ prompt: "go" },
				{ reply: "ok", provider: "claude-bridge", model: "opus", usage: cached({ input }, 0) },
			]);
		const files = [
			...[1, 1, 1, 1, 1.2].map((cost, at) => priced(`p${at}`, cost)),
			priced("p-big", 4),
			...[1000, 1000, 1000, 1000].map((input, at) => unpriced(`u${at}`, input)),
			priced("p-free", 0),
			unpriced("u-big", 9000),
		];
		const findings = await findingsOf(files);
		const [cost] = ofRule(findings, "costOutlier");
		expect(cost?.count).toBe(1);
		expect(cost?.figures.median?.value).toBe(1);
		expect(cost?.ratio).toBe(4);
		expect(cost?.links[0]?.value).toBe(4);
		const [tokens] = ofRule(findings, "tokenOutlier");
		expect(tokens?.figures.median?.value).toBe(1100);
		expect(tokens?.links.map((link) => link.value)).toEqual([9100]);
	});
});

describe("files and the user's repeats", () => {
	test("rework, repeated instructions across ≥3 sessions and claims without a test run", async () => {
		const edit = (path: string): Step => ({ call: "edit", args: { path, edits: [] } });
		const instruction = "Please run the full test suite before you say the task is done.";
		const findings = await findingsOf([
			write("r1", [
				{ prompt: `Fix the parser. ${instruction}` },
				...Array.from({ length: 5 }, () => edit("src/parser.ts")),
				{ reply: "All tests pass now." },
			]),
			write("r2", [
				{ prompt: `${instruction} Then update the docs.` },
				edit("docs/a.md"),
				bash("bun test"),
				{ reply: "All tests pass now." },
				edit("docs/b.md"),
				{ reply: "The tests are passing." },
			]),
			write("r3", [{ prompt: instruction.toLowerCase() }, { reply: "Tests pass." }]),
		]);
		const [rework] = ofRule(findings, "rework");
		expect(rework).toMatchObject({ subject: "src/parser.ts", count: 5, names: ["Alpha"] });
		expect(rework?.links[0]?.events).toHaveLength(3);
		const [repeat] = ofRule(findings, "repeatedInstruction");
		expect(repeat?.total).toBe(3);
		expect(repeat?.subject).toBe(instruction.toLowerCase());
		const [claims] = ofRule(findings, "unverifiedClaim");
		expect(claims?.count).toBe(2);
		expect(claims?.sessions).toHaveLength(2);
	});

	test("an instruction repeated in two sessions only is not a finding", async () => {
		const instruction = "Please run the full test suite before you say the task is done.";
		const findings = await findingsOf([
			write("q1", [{ prompt: instruction }]),
			write("q2", [{ prompt: instruction }]),
		]);
		expect(ofRule(findings, "repeatedInstruction")).toEqual([]);
		expect(ofRule(findings, "unverifiedClaim")).toEqual([]);
	});
});

describe("findings.list", () => {
	test("hidden findings persist in the store, flagged, and the list is deterministic", async () => {
		const files = [
			write("h1", [{ prompt: "go" }, bash("bun x", true), bash("bun x", true)]),
			write("h2", [{ prompt: "go" }, bash("bun x", true), bash("bun x")]),
		];
		const { input } = await statsOver(files);
		const store = new JsonStore(join(root, "store"));
		const first = await buildFindingsList({ ...input, store }, READY);
		expect(first.findings.map((finding) => [finding.id, finding.hidden])).toEqual([
			["command:bun x", false],
		]);
		expect(await setFindingHidden(store, { id: "command:bun x", hidden: true })).toEqual([
			"command:bun x",
		]);
		const second = await buildFindingsList({ ...input, store }, READY);
		expect(second.findings[0]?.hidden).toBe(true);
		expect(JSON.stringify(await buildFindingsList({ ...input, store }, READY))).toBe(
			JSON.stringify(second),
		);
		expect(await setFindingHidden(store, { id: "command:bun x", hidden: false })).toEqual([]);
		expect(parseHidden({ hidden: ["b", "a", "a", 3] })).toEqual({ hidden: ["a", "b"] });
		expect(parseHidden("nonsense")).toEqual({ hidden: [] });
		expect(() => parseFindingsHideParams({ id: "", hidden: true })).toThrow();
		expect(() => parseFindingsHideParams({ id: "x" })).toThrow();
	});
});
