import { expect, test } from "bun:test";
import type {
	McpServerResourceSummary,
	McpServerStatus,
	McpServerSummary,
	SessionResources,
} from "@thinkrail/contracts";
import { foldMcpSnapshot, type McpHeldSnapshot, type McpWorkspaceProjection } from "./mcp";
import { selectMcpWorkspaceStarting } from "./selectMcpServers";
import { selectChatResourceGroups } from "./selectors";

const NOW = 1_000_000;

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
): McpWorkspaceProjection {
	return {
		servers,
		configErrors: [],
		handledElsewhere: null,
		sessions: Object.fromEntries(sessions.map((held) => [held.snapshot.sessionId, held])),
	};
}

test("a workspace reads as starting while a live chat reports a server starting", () => {
	expect(
		selectMcpWorkspaceStarting(
			{ mcpByWorkspace: { ws: projection([], [session("a", [{ state: "starting" }])]) } },
			"ws",
		),
	).toBe(true);
	expect(selectMcpWorkspaceStarting({ mcpByWorkspace: {} }, "ws")).toBe(false);
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
	expect(groups.activeCount).toBe(0);
	const older = selectChatResourceGroups(base);
	expect(older.mcpServers).toBeNull();
	expect(older.mcpActiveCount).toBe(0);
	const unsupported = selectChatResourceGroups({ ...base, mcpServers }, false);
	expect(unsupported.mcpServers).toBeNull();
});
