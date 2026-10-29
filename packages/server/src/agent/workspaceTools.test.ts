import { afterEach, expect, test } from "bun:test";
import {
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	type ExtensionAPI,
	type ExtensionToolContext,
} from "@earendil-works/pi-coding-agent";
import { childExtensionFactories } from "./extensions";
import {
	boundedStatus,
	createStartWorkspaceTool,
	createWorkspaceStatusTool,
	START_WORKSPACE_TOOL_NAME,
	type StartedWorkspace,
	type StartWorkspaceParams,
	setWorkspaceToolsHost,
	WORKSPACE_STATUS_TOOL_NAME,
	type WorkspaceStatusParams,
	workspaceToolsExtension,
} from "./workspaceTools";

afterEach(() => setWorkspaceToolsHost(null));

const ctx = { sessionManager: { getSessionId: () => "s-1" } } as unknown as ExtensionToolContext;

const started: StartedWorkspace = {
	workspaceId: "w-2",
	projectId: "p-1",
	sessionId: "s-2",
	name: "workspace-2",
	branch: "workspace-2",
	baseBranch: "origin/main",
	model: "anthropic/claude",
	effort: "high",
};

test("start_workspace delegates to the host with the caller's session and returns the started ids", async () => {
	const calls: Array<[string, StartWorkspaceParams]> = [];
	setWorkspaceToolsHost({
		start: async (sessionId, params) => {
			calls.push([sessionId, params]);
			return started;
		},
		status: async () => "",
	});
	const params = { prompt: "Fix the login redirect", effort: "high" as const };
	const result = await createStartWorkspaceTool().execute("c-1", params, undefined, undefined, ctx);

	expect(calls).toEqual([["s-1", params]]);
	expect(result.details).toEqual(started);
	const text = result.content[0]?.type === "text" ? result.content[0].text : "";
	expect(text).toContain('Started workspace "workspace-2" (id w-2');
	expect(text).toContain("workspace_status");
});

test("start_workspace hands pi's abort signal to the host, so Stop reaches the start", async () => {
	const signals: Array<AbortSignal | undefined> = [];
	setWorkspaceToolsHost({
		start: async (_sessionId, _params, signal) => {
			signals.push(signal);
			return started;
		},
		status: async () => "",
	});
	const stop = new AbortController();
	await createStartWorkspaceTool().execute("c-1", { prompt: "x" }, stop.signal, undefined, ctx);
	expect(signals).toEqual([stop.signal]);
});

test("workspace_status returns the host's report as text", async () => {
	const calls: Array<[string, WorkspaceStatusParams]> = [];
	setWorkspaceToolsHost({
		start: async () => started,
		status: async (sessionId, params) => {
			calls.push([sessionId, params]);
			return "## workspace-2 — workspace-2";
		},
	});
	const result = await createWorkspaceStatusTool().execute(
		"c-1",
		{ workspaces: ["w-2"] },
		undefined,
		undefined,
		ctx,
	);
	expect(calls).toEqual([["s-1", { workspaces: ["w-2"] }]]);
	expect(result.content).toEqual([{ type: "text", text: "## workspace-2 — workspace-2" }]);
});

test("without a host the tools fail instead of pretending", async () => {
	await expect(
		createStartWorkspaceTool().execute("c-1", { prompt: "x" }, undefined, undefined, ctx),
	).rejects.toThrow("not available");
	await expect(
		createWorkspaceStatusTool().execute("c-1", {}, undefined, undefined, ctx),
	).rejects.toThrow("not available");
});

test("the guidance acts on side-workspace cues and suggests rather than starts unasked splits", () => {
	const tool = createStartWorkspaceTool();
	const guidance = [tool.description, ...(tool.promptGuidelines ?? [])].join("\n");
	expect(guidance).toContain("another, side, separate, new, or parallel workspace");
	expect(guidance).toContain("suggest starting them in separate workspaces");
	expect(guidance).toContain("commit (or attach) anything it needs");
	expect(guidance).toContain("self-contained prompt");
});

test("both tools are registered for top-level sessions, never in a subagent child's factories", () => {
	const registered: string[] = [];
	const pi = {
		registerTool: (t: { name: string }) => registered.push(t.name),
		on: () => {},
	} as unknown as ExtensionAPI;
	workspaceToolsExtension(pi);
	expect(registered).toEqual([START_WORKSPACE_TOOL_NAME, WORKSPACE_STATUS_TOOL_NAME]);
	expect(childExtensionFactories("w1")).not.toContain(workspaceToolsExtension);
});

test("workspace_status bounds a long report by lines or bytes and says how to narrow it", async () => {
	const footer = (text: string) =>
		`[workspace_status output truncated: ${text.split("\n").length} lines, ${Buffer.byteLength(text)} bytes in all; the later workspaces and older chats were cut. Name specific (or fewer) workspaces to see more of each.]`;
	const manyLines = Array.from({ length: 3000 }, (_, i) => `- chat ${i}: idle`).join("\n");
	const manyBytes = Array.from({ length: 80 }, (_, i) => `${i} ${"x".repeat(1000)}`).join("\n");
	setWorkspaceToolsHost({ start: async () => started, status: async () => manyLines });
	const result = await createWorkspaceStatusTool().execute("c-1", {}, undefined, undefined, ctx);
	expect(result.content).toEqual([{ type: "text", text: boundedStatus(manyLines) }]);

	for (const report of [manyLines, manyBytes]) {
		const bounded = boundedStatus(report);
		expect(bounded.split("\n").length).toBeLessThanOrEqual(DEFAULT_MAX_LINES);
		expect(Buffer.byteLength(bounded)).toBeLessThanOrEqual(DEFAULT_MAX_BYTES);
		expect(report.startsWith(bounded.slice(0, bounded.lastIndexOf("\n\n[")))).toBe(true);
		expect(bounded.endsWith(`\n\n${footer(report)}`)).toBe(true);
	}
	expect(boundedStatus("## main — main\nno chats")).toBe("## main — main\nno chats");
});
