import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { runDetails, TranscriptBuilder, tempDir, usage, writeSession } from "../test/builders.ts";
import {
	BADGED_ORIGINS,
	type ListProject,
	METRIC_SOURCES,
	SESSION_INSIGHTS_API_VERSION,
	type SessionListRow,
} from "./core.ts";
import { listSessionFiles } from "./discovery.ts";
import {
	buildSessionSummary,
	buildSessionsList,
	parseSessionsListParams,
	type SessionPlacement,
} from "./list.ts";
import { createRedactor, secretFindings } from "./redact.ts";
import { SessionIndex } from "./sessionIndex.ts";

const root = tempDir("list");
afterAll(() => rmSync(root, { recursive: true, force: true }));

const PROJECTS: readonly ListProject[] = [
	{ id: "p1", name: "Alpha", kind: "repository" },
	{ id: "p2", name: "Beta", kind: "repository" },
	{ id: "chats", name: "Chats", kind: "chats" },
];

const PLACEMENTS: Readonly<Record<string, SessionPlacement | null>> = {
	"/work/alpha": { projectId: "p1", workspaceId: "w1", workspaceName: "main", workspace: "open" },
	"/work/beta": { projectId: "p2", workspaceId: "w2", workspaceName: "main", workspace: "open" },
	"/work/gone": {
		projectId: "p1",
		workspaceId: null,
		workspaceName: "workspace-3",
		workspace: "removed",
	},
	"/elsewhere": { projectId: null, workspaceId: null, workspaceName: null, workspace: "none" },
	"/hidden": null,
};

function at(minutes: number): number {
	return Date.parse("2026-11-01T10:00:00.000Z") + minutes * 60_000;
}

async function fixture(name: string) {
	const sessions = join(root, name, "sessions");
	const children = join(root, name, "children");
	mkdirSync(sessions, { recursive: true });

	const priced = new TranscriptBuilder({ id: "priced", cwd: "/work/alpha", start: at(0) });
	priced.user("Priced prompt");
	priced.assistant({ toolCalls: [{ id: "c1", name: "bash" }], usage: usage(10, 0.4) });
	priced.toolResult({ toolCallId: "c1", toolName: "bash", isError: true });
	priced.assistant({ toolCalls: [{ id: "s1", name: "Agent" }], usage: usage(10, 0.1) });
	priced.toolResult({
		toolCallId: "s1",
		toolName: "Agent",
		details: runDetails("kid", "completed", { tokens: 20, cost: 0.3 }),
	});
	priced.usageEntry("subagent", usage(5, 0.1), "kid");
	writeSession(sessions, "alpha", priced);

	const bridge = new TranscriptBuilder({ id: "bridge", cwd: "/work/beta", start: at(30) });
	bridge.user("Bridge prompt");
	bridge.assistant({ provider: "claude-bridge", model: "opus", usage: usage(100, 0) });
	writeSession(sessions, "beta", bridge);

	const mixed = new TranscriptBuilder({ id: "mixed", cwd: "/work/alpha", start: at(30) });
	mixed.sessionInfo("Mixed spend");
	mixed.assistant({ provider: "claude-bridge", model: "opus", usage: usage(1, 0) });
	mixed.assistant({ usage: usage(1, 0.2) });
	writeSession(sessions, "alpha", mixed);

	const removed = new TranscriptBuilder({ id: "removed", cwd: "/work/gone", start: at(10) });
	removed.assistant({ toolCalls: [{ id: "s2", name: "Agent" }] });
	removed.toolResult({
		toolCallId: "s2",
		toolName: "Agent",
		details: runDetails("lost", "completed", { tokens: 1, cost: 0.01 }),
	});
	writeSession(sessions, "gone", removed);

	const orphan = new TranscriptBuilder({ id: "orphan", cwd: "/elsewhere", start: at(5) });
	orphan.user("Outside every project");
	orphan.assistant({ toolCalls: [{ id: "s3", name: "Agent" }] });
	orphan.toolResult({
		toolCallId: "s3",
		toolName: "Agent",
		details: runDetails("pending", "running", { tokens: 0, cost: 0 }),
	});
	writeSession(sessions, "elsewhere", orphan);

	writeSession(sessions, "hidden", new TranscriptBuilder({ id: "hidden", cwd: "/hidden" }));

	const kid = new TranscriptBuilder({ id: "kid", cwd: "/work/alpha", start: at(1) });
	kid.user("Child task");
	kid.assistant({ usage: usage(30, 0.5) });
	writeSession(children, "priced", kid);

	const index = new SessionIndex({
		sessionFiles: () => listSessionFiles(sessions),
		childTranscriptDirs: async ({ sessionId }) =>
			sessionId === "priced" ? [join(children, "priced")] : [],
	});
	const state = await index.ensureFresh(10_000);
	return buildSessionsList(
		{
			index,
			projects: PROJECTS,
			place: (cwd) => PLACEMENTS[cwd] ?? null,
			status: (sessionId) => ({
				live: sessionId === "bridge",
				outcome: sessionId === "priced" ? "succeeded" : null,
			}),
		},
		state,
	);
}

function rowOf(rows: readonly SessionListRow[], sessionId: string): SessionListRow {
	const row = rows.find((candidate) => candidate.sessionId === sessionId);
	if (!row) throw new Error(`no row ${sessionId}`);
	return row;
}

describe("sessions.list", () => {
	test("rows are placed by the embedder, sorted by start then id, with projects in latest-start order", async () => {
		const result = await fixture("order");
		expect(result.apiVersion).toBe(SESSION_INSIGHTS_API_VERSION);
		expect(result.state).toEqual({ phase: "ready", indexed: 6, total: 6 });
		expect(result.sources).toEqual(METRIC_SOURCES);
		expect(result.rows.map((row) => row.sessionId)).toEqual([
			"bridge",
			"mixed",
			"removed",
			"orphan",
			"priced",
		]);
		expect(result.projects.map((project) => project.id)).toEqual(["p1", "p2"]);
		expect(rowOf(result.rows, "orphan")).toMatchObject({
			projectId: null,
			workspaceState: "none",
		});
	});

	test("pi-recorded totals, counted calls and approximated time carry their origins", async () => {
		const row = rowOf((await fixture("priced")).rows, "priced");
		expect(row).toMatchObject({
			workspaceId: "w1",
			workspaceState: "open",
			title: null,
			firstPrompt: "Priced prompt",
			live: false,
			outcome: "succeeded",
			start: { value: at(0) + 1000, origin: "counted" },
			activeMs: { origin: "approximated" },
			tokens: { value: { input: 25, total: 4 * 25 + 18 }, origin: "recorded" },
			toolCalls: { value: 2, origin: "counted" },
			toolErrors: { value: 1, origin: "counted" },
			subagents: { value: 1, origin: "counted" },
			models: ["anthropic/claude-test"],
		});
		expect(row.cost.origin).toBe("recorded");
		expect(row.cost.value).toBeCloseTo(0.6, 12);
		expect(row.subagentsOutside.origin).toBe("recorded");
		expect(row.subagentsOutside.value?.tokens).toBe(4 * 30 + 6 - (4 * 5 + 6));
		expect(row.subagentsOutside.value?.cost).toBeCloseTo(0.4, 12);
	});

	test("$0 models read as not recorded with their tokens, mixed spend as partially recorded", async () => {
		const { rows } = await fixture("cost");
		expect(rowOf(rows, "bridge")).toMatchObject({
			live: true,
			cost: { value: 0, origin: "notRecorded" },
			tokens: { value: { total: 406 }, origin: "recorded" },
		});
		expect(rowOf(rows, "mixed")).toMatchObject({
			title: "Mixed spend",
			firstPrompt: null,
			cost: { value: 0.2, origin: "partiallyRecorded" },
		});
	});

	test("subagents of a removed workspace or without a transcript or final report are not measured", async () => {
		const { rows } = await fixture("unmeasured");
		expect(rowOf(rows, "removed")).toMatchObject({
			workspaceState: "removed",
			workspaceName: "workspace-3",
			subagents: { value: 1, origin: "notMeasured" },
			subagentsOutside: { origin: "notMeasured" },
		});
		expect(rowOf(rows, "orphan")).toMatchObject({
			subagents: { value: 1, origin: "notMeasured" },
			subagentsOutside: { value: { cost: 0, tokens: 0 }, origin: "notMeasured" },
		});
		for (const row of rows) {
			for (const figure of [row.start, row.tokens, row.toolCalls, row.toolErrors])
				expect(BADGED_ORIGINS).not.toContain(figure.origin);
		}
	});

	test("titles and first-prompt excerpts are redacted whole before they are collapsed and cut", async () => {
		const sessions = join(root, "redacted", "sessions");
		mkdirSync(sessions, { recursive: true });
		const secret = new TranscriptBuilder({ id: "secret", cwd: "/work/alpha", start: at(0) });
		secret.sessionInfo("Deploy with ghp_abcdefghijklmnopqrstuvwxyz0123456789");
		secret.user(
			`Read /home/alice/notes.md, ${"word ".repeat(20)}then export API_KEY=supersecretvalue1234 and go`,
		);
		writeSession(sessions, "secret", secret);
		const index = new SessionIndex({
			sessionFiles: () => listSessionFiles(sessions),
			childTranscriptDirs: async () => [],
			redactor: createRedactor("/home/alice"),
		});
		const { rows } = await buildSessionsList(
			{
				index,
				projects: PROJECTS,
				place: (cwd) => PLACEMENTS[cwd] ?? null,
				status: () => ({ live: false, outcome: null }),
			},
			await index.ensureFresh(10_000),
		);
		const row = rowOf(rows, "secret");
		expect(row.title).toBe("Deploy with [redacted]");
		expect(row.firstPrompt?.startsWith("Read ~/notes.md, word word")).toBe(true);
		expect(row.firstPrompt?.endsWith("export API_KEY=…")).toBe(true);
		expect(secretFindings(`${row.title} ${row.firstPrompt}`, "/home/alice")).toEqual([]);
	});

	test("the header's wall time ends at the last work, not at settings a restored chat appended", async () => {
		const sessions = join(root, "restored", "sessions");
		mkdirSync(sessions, { recursive: true });
		const start = Date.parse("2024-11-27T10:00:00Z");
		const builder = new TranscriptBuilder({ id: "restored", cwd: "/work/alpha", start });
		builder.user("Old work");
		builder.assistant({ text: "Done." });
		const activeEnd = builder.now();
		builder.advance(725 * 24 * 3600_000).thinkingLevel("medium");
		writeSession(sessions, "alpha", builder);
		const index = new SessionIndex({
			sessionFiles: () => listSessionFiles(sessions),
			childTranscriptDirs: async () => [],
		});
		const state = await index.ensureFresh(10_000);
		const result = await buildSessionSummary(
			{
				index,
				projects: PROJECTS,
				place: (cwd) => PLACEMENTS[cwd] ?? null,
				status: () => ({ live: false, outcome: null }),
			},
			state,
			"restored",
		);
		expect(result.session?.wallMs).toEqual({ value: activeEnd - start - 1000, origin: "counted" });
	});

	test("the same files give byte-identical results", async () => {
		const first = JSON.stringify(await fixture("first"));
		const second = JSON.stringify(await fixture("second"));
		expect(second).toBe(first);
	});
});

describe("parseSessionsListParams", () => {
	test("accepts the two scopes and rejects anything else", () => {
		expect(parseSessionsListParams({ scope: { kind: "all" } })).toEqual({ scope: { kind: "all" } });
		expect(parseSessionsListParams({ scope: { kind: "all" }, fresh: true })).toEqual({
			scope: { kind: "all" },
			fresh: true,
		});
		expect(parseSessionsListParams({ scope: { kind: "all" }, fresh: false })).toEqual({
			scope: { kind: "all" },
		});
		expect(parseSessionsListParams({ scope: { kind: "project", projectId: "p1", x: 1 } })).toEqual({
			scope: { kind: "project", projectId: "p1" },
		});
		for (const bad of [
			undefined,
			null,
			{},
			{ scope: "all" },
			{ scope: { kind: "project" } },
			{ scope: { kind: "project", projectId: "" } },
			{ scope: { kind: "chat" } },
			{ scope: { kind: "all" }, fresh: "yes" },
		])
			expect(() => parseSessionsListParams(bad)).toThrow("Invalid sessions.list params");
	});
});
