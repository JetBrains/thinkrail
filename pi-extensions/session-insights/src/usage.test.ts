import { afterAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import {
	cached,
	runDetails,
	TranscriptBuilder,
	tempDir,
	usage,
	writeSession,
} from "../test/builders.ts";
import { statsOver } from "../test/stats.ts";
import { SPARK_POINTS } from "./core.ts";
import { statsScope } from "./crossSession.ts";
import { digestInStages, digestOf } from "./digest.ts";
import { createRedactor } from "./redact.ts";
import { skillListing } from "./trace.ts";
import { TraceStore } from "./traceStore.ts";
import { buildStatsUsage } from "./usage.ts";

const root = tempDir("usage");
afterAll(() => rmSync(root, { recursive: true, force: true }));

const day = (date: number, hour = 10) => new Date(2026, 10, date, hour).getTime();
const READY = { phase: "ready", indexed: 0, total: 0 } as const;

function skillsSection(names: readonly string[]): string {
	return [
		"<skills>",
		"The following skills provide specialized instructions for specific tasks.",
		"<available_skills>",
		...names.flatMap((name) => [
			"  <skill>",
			`    <name>${name}</name>`,
			`    <description>How to ${name} in this repository.</description>`,
			`    <location>/home/me/.pi/skills/${name}/SKILL.md</location>`,
			"  </skill>",
		]),
		"</available_skills>",
		"</skills>",
	].join("\n");
}

function alpha(): TranscriptBuilder {
	const builder = new TranscriptBuilder({ id: "alpha-1", cwd: "/work/a", start: day(1) });
	builder.system({ sections: { skills: skillsSection(["review", "deploy"]) } });
	builder.user("Fix the parser please");
	builder.assistant({
		toolCalls: [
			{ id: "s1", name: "read", arguments: { path: "/home/me/.pi/skills/review/SKILL.md" } },
			{ id: "b1", name: "bash", arguments: { command: "bun test parser" } },
		],
		usage: cached({ input: 1000, cacheRead: 3000, cacheWrite: 100 }, 0.5),
		durationMs: 2000,
	});
	builder.toolResult({ toolCallId: "s1", toolName: "read", text: "# Review", durationMs: 100 });
	builder.toolResult({
		toolCallId: "b1",
		toolName: "bash",
		isError: true,
		text: "1 fail\nCommand exited with code 1",
		durationMs: 3000,
	});
	builder.assistant({
		toolCalls: [{ id: "a1", name: "Agent", arguments: { subagent_type: "scout", task: "Look" } }],
		usage: cached({ input: 500, cacheRead: 3500 }, 0.25),
		durationMs: 4000,
	});
	builder.toolResult({
		toolCallId: "a1",
		toolName: "Agent",
		details: runDetails("child-1", "completed", { tokens: 100, cost: 0.2 }),
	});
	builder.usageEntry("subagent", usage(100, 0.2), "child-1");
	builder.assistant({ text: "Done", usage: cached({ input: 200 }, 0.05), durationMs: 1000 });
	return builder;
}

function alphaLater(): TranscriptBuilder {
	const builder = new TranscriptBuilder({ id: "alpha-2", cwd: "/work/a", start: day(3) });
	builder.user("Run the tests");
	builder.assistant({
		toolCalls: [{ id: "b2", name: "bash", arguments: { command: "bun test" } }],
		usage: cached({ input: 1000 }, 0.4),
		durationMs: 1000,
	});
	builder.toolResult({ toolCallId: "b2", toolName: "bash", text: "ok", durationMs: 1000 });
	builder.assistant({
		text: "ok",
		provider: "claude-bridge",
		model: "claude-opus",
		usage: cached({ input: 7000 }, 0),
	});
	return builder;
}

function beta(): TranscriptBuilder {
	const builder = new TranscriptBuilder({ id: "beta-1", cwd: "/work/b", start: day(4) });
	builder.user("/skill:deploy ship it");
	builder.assistant({
		text: "Shipping",
		provider: "claude-bridge",
		model: "claude-opus",
		usage: cached({ input: 9000, cacheRead: 1000 }, 0),
	});
	return builder;
}

async function corpus() {
	const files = [
		writeSession(root, "a1", alpha()),
		writeSession(root, "a2", alphaLater()),
		writeSession(root, "b1", beta()),
	];
	return statsOver(files, {
		contextWindow: async (provider) => (provider === "anthropic" ? 200_000 : null),
	});
}

describe("skill listings", () => {
	test("parse pi's available_skills entries with their size", () => {
		const listing = skillListing(skillsSection(["review", "a&amp;b"]), createRedactor("/home/me"));
		expect(listing.map((skill) => skill.name)).toEqual(["review", "a&b"]);
		expect(listing[0]?.chars).toBeGreaterThan(100);
		expect(skillListing("<skills>\n- review: legacy text\n</skills>", createRedactor())).toEqual(
			[],
		);
	});
});

describe("stats.usage", () => {
	test("puts every day of the range on the axis and splits spend by model, subagents and other", async () => {
		const { input } = await corpus();
		const {
			usage: stats,
			digests,
			sessions,
		} = await buildStatsUsage({ ...input, place: (cwd) => input.place(cwd) }, READY);
		expect(digests).toEqual({ ready: 3, total: 3, stale: 0 });
		expect(sessions.map((session) => session.sessionId)).toEqual(["beta-1", "alpha-2", "alpha-1"]);
		expect(stats.days).toEqual(["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04"]);
		expect(stats.headline).toBe("cost");
		const keys = stats.byModel.map((series) => [series.kind, series.key]);
		expect(keys).toEqual([
			["model", "claude-bridge/claude-opus"],
			["model", "anthropic/claude-test"],
			["subagents", "subagents"],
		]);
		const bridge = stats.byModel[0];
		expect(bridge?.costOrigin).toBe("notRecorded");
		expect(bridge?.tokens).toEqual([0, 0, 7100, 10_100]);
		const claude = stats.byModel[1];
		expect(claude?.cost.map((cost) => Number(cost.toFixed(2)))).toEqual([0.8, 0, 0.4, 0]);
		expect(stats.byModel[2]?.cost[0]).toBeCloseTo(0.2);
		expect(stats.byProject.map((series) => [series.key, series.name])).toEqual([
			["p1", "Alpha"],
			["p2", "Beta"],
		]);
		expect(stats.totals.cost.value).toBeCloseTo(1.4);
		expect(stats.totals.cost.origin).toBe("partiallyRecorded");
		expect(stats.markers).toEqual([
			{ day: "2026-11-03", kind: "unpricedModel", model: "claude-bridge/claude-opus" },
		]);
	});

	test("tables count calls, errors with a Wilson interval, durations, skills and roles", async () => {
		const { input } = await corpus();
		const { usage: stats } = await buildStatsUsage(input, READY);
		const claude = stats.models.find((row) => row.model === "anthropic/claude-test");
		expect(claude?.calls.value).toBe(4);
		expect(claude?.contextWindow).toEqual({ value: 200_000, origin: "host" });
		expect(claude?.latencyP50).toEqual({ value: 1500, origin: "recorded" });
		expect(claude?.sessions).toEqual([1, 2]);
		const bridge = stats.models.find((row) => row.model === "claude-bridge/claude-opus");
		expect(bridge?.cost).toEqual({ value: 0, origin: "notRecorded" });
		expect(bridge?.contextWindow.origin).toBe("approximated");
		expect(bridge?.latencyP50).toEqual({ value: null, origin: "notMeasured" });

		const bash = stats.tools.find((row) => row.name === "bash");
		expect(bash?.calls.value).toBe(2);
		expect(bash?.errors.value).toBe(1);
		expect(bash?.errorRate?.k).toBe(1);
		expect(bash?.errorRate?.low).toBeCloseTo(0.0945, 3);
		expect(bash?.errorRate?.high).toBeCloseTo(0.9055, 3);
		expect(bash?.durationAvg).toEqual({ value: 2000, origin: "recorded" });
		expect(bash?.perDay.length).toBeLessThanOrEqual(SPARK_POINTS);
		expect(stats.commands.map((row) => [row.name, row.calls.value, row.errors.value])).toEqual([
			["bun test", 1, 0],
			["bun test parser", 1, 1],
		]);

		expect(stats.listingSessions).toBe(1);
		const review = stats.skills.find((row) => row.name === "review");
		expect(review?.loads.value).toBe(1);
		expect(review?.neverLoaded).toBe(false);
		const deploy = stats.skills.find((row) => row.name === "deploy");
		expect(deploy?.loads.value).toBe(1);
		expect(deploy?.descriptionTokens.origin).toBe("approximated");

		expect(stats.roles).toHaveLength(1);
		expect(stats.roles[0]?.role).toBe("scout");
		expect(stats.roles[0]?.runs.value).toBe(1);
		expect(stats.projects.find((row) => row.projectId === "p1")?.sessions).toEqual([1, 2]);
	});

	test("a scope and its digests: built once per file revision, reused by every query", async () => {
		const { input, builds } = await corpus();
		await buildStatsUsage(input, READY);
		await buildStatsUsage(input, READY);
		expect(builds()).toBe(3);
		const projectOnly = await statsScope(
			{ ...input, place: (cwd) => (cwd.startsWith("/work/a") ? input.place(cwd) : null) },
			READY,
		);
		expect(projectOnly.sessions.map((session) => session.sessionId)).toEqual([
			"alpha-2",
			"alpha-1",
		]);
		expect(builds()).toBe(3);
	});

	test("answers within its budget with what is built and reports the progress", async () => {
		const files = [writeSession(root, "slow", alpha())];
		const { input } = await statsOver(files, { budgetMs: 0 });
		const first = await buildStatsUsage(input, READY);
		expect(first.digests).toEqual({ ready: 0, total: 1, stale: 0 });
		expect(first.usage.days).toEqual([]);
		await new Promise((resolve) => setTimeout(resolve, 200));
		expect((await buildStatsUsage(input, READY)).digests).toEqual({
			ready: 1,
			total: 1,
			stale: 0,
		});
	});

	test("a growing session stays counted from its previous digest until the new one replaces it", async () => {
		const builder = alpha();
		const file = writeSession(root, "growing", builder);
		const { input, index, builds } = await statsOver([file], { budgetMs: 10_000 });
		const first = await buildStatsUsage(input, READY);
		expect(first.digests).toEqual({ ready: 1, total: 1, stale: 0 });
		const before = index.summaryOf("alpha-1");
		builder.user("One more thing");
		builder.assistant({ text: "Done again", usage: cached({ input: 300 }, 0.1) });
		writeSession(root, "growing", builder);
		await index.ensureFresh(10_000, { fresh: true });
		const after = index.summaryOf("alpha-1");
		if (!before || !after) throw new Error("expected both revisions");
		expect(after).not.toBe(before);
		const stale = await buildStatsUsage({ ...input, budgetMs: 0 }, READY);
		expect(stale.digests).toEqual({ ready: 1, total: 1, stale: 1 });
		expect(stale.usage.days).toEqual(first.usage.days);
		expect(input.digests.get(after)).toBeUndefined();
		expect(input.digests.latest(after)).toBeDefined();
		const fresh = await buildStatsUsage(input, READY);
		expect(fresh.digests).toEqual({ ready: 1, total: 1, stale: 0 });
		expect(input.digests.get(after)).toBeDefined();
		expect(input.digests.get(before)).toBeUndefined();
		expect(builds()).toBe(2);
	});

	test("marks the day a priced model starts recording $0 for good", async () => {
		const priced = (id: string, date: number, cost: number) => {
			const builder = new TranscriptBuilder({ id, cwd: "/work/a", start: day(date) });
			builder.user("go");
			builder.assistant({ text: "ok", usage: cached({ input: 1000 }, cost) });
			return writeSession(root, id, builder);
		};
		const { input } = await statsOver([
			priced("m1", 10, 0.3),
			priced("m2", 11, 0),
			priced("m3", 13, 0),
		]);
		const { usage: stats } = await buildStatsUsage(input, READY);
		expect(stats.days).toHaveLength(4);
		expect(stats.markers).toEqual([
			{ day: "2026-11-11", kind: "costStopped", model: "anthropic/claude-test" },
		]);
	});

	test("a change marker needs a day of spend before it: none on the first day of the history", async () => {
		const session = (id: string, date: number, subagent: boolean) => {
			const builder = new TranscriptBuilder({ id, cwd: "/work/a", start: day(date) });
			builder.user("go");
			builder.assistant({ text: "ok", usage: cached({ input: 1000 }, 0.3) });
			if (subagent) builder.usageEntry("subagent", usage(100, 0.1), "kid");
			return writeSession(root, id, builder);
		};
		const single = await statsOver([session("d1", 20, true)]);
		const alone = await buildStatsUsage(single.input, READY);
		expect(alone.usage.days).toEqual(["2026-11-20"]);
		expect(alone.usage.markers).toEqual([]);
		const later = await statsOver([session("d2", 21, false), session("d3", 22, true)]);
		const { usage: stats } = await buildStatsUsage(later.input, READY);
		expect(stats.markers).toEqual([{ day: "2026-11-22", kind: "subagentSpend", model: null }]);
	});

	test("a digest built in stages equals the one built at once", async () => {
		const { input, index } = await corpus();
		const traces = new TraceStore({ sliceMs: 1000 });
		for (const summary of index.summaries()) {
			const trace = await traces.trace(summary.file);
			if (!trace) throw new Error("no trace");
			expect(await digestInStages(trace, summary)).toEqual(digestOf(trace, summary));
		}
		expect(input.digests).toBeDefined();
	});

	test("is deterministic", async () => {
		const { input } = await corpus();
		const a = JSON.stringify(await buildStatsUsage(input, READY));
		const b = JSON.stringify(await buildStatsUsage(input, READY));
		expect(a).toBe(b);
	});
});
