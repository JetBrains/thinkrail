import { expect, test } from "bun:test";
import type {
	McpServerResourceSummary,
	McpServerStatus,
	McpServerSummary,
	SessionResources,
} from "@thinkrail/contracts";
import { foldMcpSnapshot, type McpHeldSnapshot, type McpWorkspaceProjection } from "./mcp";
import {
	deriveMcpServerRows,
	MCP_STARTING_BOUND_MS,
	type McpServerRow,
	selectMcpWorkspaceStarting,
} from "./selectMcpServers";
import { selectChatResourceGroups } from "./selectors";

const NOW = 1_000_000;

function summary(name: string, overrides: Partial<McpServerSummary> = {}): McpServerSummary {
	return {
		name,
		scope: "user",
		source: "/home/me/.pi/agent/mcp.json",
		transport: "stdio",
		endpoint: `bun ${name}.ts`,
		exposure: "deferred",
		effectiveExposure: "deferred",
		enabled: true,
		oauth: false,
		...overrides,
	};
}

function session(sessionId: string, servers: Partial<McpServerStatus>[]): McpHeldSnapshot {
	return foldMcpSnapshot(
		undefined,
		{
			workspaceId: "ws",
			sessionId,
			generation: 1,
			servers: servers.map((server) => ({
				name: "docs",
				state: "connected",
				updatedAt: NOW,
				...server,
			})),
		},
		1,
		0,
	) as McpHeldSnapshot;
}

function projection(
	servers: McpServerSummary[],
	sessions: McpHeldSnapshot[] = [],
	extra: Partial<McpWorkspaceProjection> = {},
): McpWorkspaceProjection {
	return {
		servers,
		configErrors: [],
		handledElsewhere: null,
		sessions: Object.fromEntries(sessions.map((held) => [held.snapshot.sessionId, held])),
		...extra,
	};
}

const byName = (rows: McpServerRow[], key: string) => rows.find((row) => row.key === key);

test("with no live chat the state comes from configuration", () => {
	const rows = deriveMcpServerRows(
		projection([
			summary("docs"),
			summary("off", { enabled: false }),
			summary("muted", { enabled: false, projectOverride: { enabled: false } }),
			summary("broken", { configError: 'server "broken": url must be an http or https URL' }),
			summary("repo", {
				scope: "project",
				approval: { state: "pending", fingerprint: "f" },
			}),
		]),
		NOW,
	);
	expect(rows.map((row) => [row.key, row.state])).toEqual([
		["project:repo", "pending-approval"],
		["user:broken", "invalid-config"],
		["user:docs", "not-running"],
		["user:muted", "disabled-in-project"],
		["user:off", "disabled"],
	]);
	expect(byName(rows, "user:broken")?.detail).toContain("url must be");
	expect(byName(rows, "project:repo")?.attention).toBe(true);
	expect(byName(rows, "user:broken")?.attention).toBe(false);
});

test("across live chats a problem in any chat wins, and the row names the chats reporting its state", () => {
	const connected = deriveMcpServerRows(
		projection(
			[summary("docs")],
			[
				session("a", [{ toolCount: 2 }]),
				session("b", [{ toolCount: 2 }]),
				session("c", [{ state: "disabled-in-chat" }]),
			],
		),
		NOW,
	)[0];
	expect(connected).toMatchObject({
		state: "connected",
		toolCount: 2,
		sessions: { total: 3, connected: 2, reporting: ["a", "b"] },
		attention: false,
	});
	const failing = deriveMcpServerRows(
		projection(
			[summary("docs")],
			[
				session("a", [{ toolCount: 2 }]),
				session("b", [{ state: "failed", detail: "docs: failed: spawn ENOENT" }]),
			],
		),
		NOW,
	)[0];
	expect(failing).toMatchObject({
		state: "failed",
		detail: "docs: failed: spawn ENOENT",
		sessions: { total: 2, connected: 1, reporting: ["b"] },
		attention: true,
	});
	const reloading = deriveMcpServerRows(
		projection(
			[summary("docs")],
			[
				session("a", [{ state: "pending-reload" }]),
				session("b", [{ toolCount: 2 }]),
				session("c", [{ state: "pending-reload" }]),
			],
		),
		NOW,
	)[0];
	expect(reloading).toMatchObject({
		state: "pending-reload",
		sessions: { total: 3, connected: 1, reporting: ["a", "c"] },
	});
	const unreported = deriveMcpServerRows(projection([summary("docs")], [session("a", [])]), NOW);
	expect(unreported[0]).toMatchObject({
		state: "unknown",
		sessions: { total: 1, connected: 0, reporting: [] },
	});
	const partly = deriveMcpServerRows(
		projection([summary("docs")], [session("a", [{ toolCount: 1 }]), session("b", [])]),
		NOW,
	)[0];
	expect(partly).toMatchObject({ state: "connected", sessions: { total: 2, connected: 1 } });
	const disabled = deriveMcpServerRows(
		projection([summary("docs", { enabled: false })], [session("a", [])]),
		NOW,
	)[0];
	expect(disabled?.state).toBe("disabled");
});

test("starting is bounded: past the bound it reads as unknown and stalled", () => {
	const startedAt = NOW - 10_000;
	const fresh = deriveMcpServerRows(
		projection([summary("docs")], [session("a", [{ state: "starting", updatedAt: startedAt }])]),
		NOW,
	)[0];
	expect(fresh).toMatchObject({
		state: "starting",
		startingSince: startedAt,
		startingStalled: false,
	});
	const stalled = deriveMcpServerRows(
		projection(
			[summary("docs")],
			[session("a", [{ state: "starting", updatedAt: NOW - MCP_STARTING_BOUND_MS - 1 }])],
		),
		NOW,
	)[0];
	expect(stalled).toMatchObject({ state: "unknown", startingStalled: true });
});

test("a workspace reads as starting while a live chat reports a server starting", () => {
	expect(
		selectMcpWorkspaceStarting(
			{ mcpByWorkspace: { ws: projection([], [session("a", [{ state: "starting" }])]) } },
			"ws",
		),
	).toBe(true);
	expect(selectMcpWorkspaceStarting({ mcpByWorkspace: {} }, "ws")).toBe(false);
});

test("a same-name pair runs the approved project entry and replaces the user one; an unapproved one leaves the user entry running", () => {
	const approved = deriveMcpServerRows(
		projection(
			[
				summary("docs"),
				summary("docs", {
					scope: "project",
					replacesGlobal: true,
					approval: { state: "approved", fingerprint: "f" },
				}),
			],
			[session("a", [{ toolCount: 1 }])],
		),
		NOW,
	);
	expect(approved.map((row) => [row.key, row.state])).toEqual([
		["project:docs", "connected"],
		["user:docs", "replaced"],
	]);
	const pending = deriveMcpServerRows(
		projection(
			[
				summary("docs"),
				summary("docs", {
					scope: "project",
					replacesGlobal: true,
					approval: { state: "changed", fingerprint: "g" },
				}),
			],
			[session("a", [{ toolCount: 1 }])],
		),
		NOW,
	);
	expect(pending.map((row) => [row.key, row.state])).toEqual([
		["project:docs", "pending-approval"],
		["user:docs", "connected"],
	]);
});

test("a pending repository override flags its user row for attention without hiding the live state", () => {
	const [row] = deriveMcpServerRows(
		projection(
			[summary("docs", { approval: { state: "pending", fingerprint: "o" } })],
			[session("a", [{ toolCount: 3 }])],
		),
		NOW,
	);
	expect(row).toMatchObject({ state: "connected", approvalPending: true, attention: true });
});

test("handled elsewhere makes every row read-only, and attention rows sort first with disabled rows last", () => {
	const elsewhere = deriveMcpServerRows(
		projection([summary("docs")], [], { handledElsewhere: { by: "my-mcp" } }),
		NOW,
	);
	expect(elsewhere[0]).toMatchObject({ state: "handled-elsewhere", attention: false });
	const ordered = deriveMcpServerRows(
		projection(
			[
				summary("alpha", { enabled: false }),
				summary("beta"),
				summary("gamma", { transport: "http", oauth: true }),
			],
			[session("a", [{ name: "beta" }, { name: "gamma", state: "needs-sign-in" }])],
		),
		NOW,
	);
	expect(ordered.map((row) => row.summary.name)).toEqual(["gamma", "beta", "alpha"]);
	expect(deriveMcpServerRows(undefined, NOW)).toEqual([]);
});

test("chat resource groups add the session's MCP servers, attention first, without changing the work count", () => {
	const mcpServers: McpServerResourceSummary[] = [
		{ name: "zeta", state: "connected", toolCount: 2, transport: "stdio" },
		{ name: "alpha", state: "starting", transport: "http" },
		{ name: "mid", state: "needs-sign-in", transport: "http" },
		{ name: "off", state: "disabled-in-chat", transport: "stdio" },
	];
	const base: SessionResources = { workspaceId: "ws", sessionId: "s", commands: [], subagents: [] };
	const groups = selectChatResourceGroups({ ...base, mcpServers });
	expect(groups.mcpServers?.map((server) => server.name)).toEqual(["mid", "alpha", "off", "zeta"]);
	expect(groups.mcpActiveCount).toBe(2);
	expect(groups.mcpAttentionCount).toBe(1);
	expect(groups.activeCount).toBe(0);
	const older = selectChatResourceGroups(base);
	expect(older.mcpServers).toBeNull();
	expect(older.mcpActiveCount).toBe(0);
	const unsupported = selectChatResourceGroups({ ...base, mcpServers }, false);
	expect(unsupported.mcpServers).toBeNull();
	expect(unsupported.mcpAttentionCount).toBe(0);
});
