import { beforeEach, expect, test } from "bun:test";
import {
	MCP_PROTOCOL_VERSION,
	type McpListResult,
	type McpServerStatus,
	type McpStatusSnapshot,
} from "@thinkrail/contracts";
import { useAppStore } from "./index";
import { foldMcpList, foldMcpSnapshot, isNewerMcpSnapshot, type McpHeldSnapshot } from "./mcp";
import { selectMcpRead } from "./selectMcpServers";

const workspaceId = "mcp-ws";
const status = (
	name: string,
	state: McpServerStatus["state"],
	updatedAt = 10,
): McpServerStatus => ({
	name,
	state,
	updatedAt,
});
const snapshot = (
	sessionId: string,
	generation: number,
	servers: McpServerStatus[] = [status("docs", "connected")],
): McpStatusSnapshot => ({ workspaceId, sessionId, generation, servers });
const held = (value: McpStatusSnapshot, connectionGeneration = 1, revision = 0): McpHeldSnapshot =>
	foldMcpSnapshot(undefined, value, connectionGeneration, revision) as McpHeldSnapshot;
const list = (statuses: McpStatusSnapshot[]): McpListResult => ({
	servers: [],
	statuses,
});
const state = useAppStore.getState;

beforeEach(() => {
	useAppStore.setState({
		mcpByWorkspace: {},
		mcpRevision: 0,
		removedWorkspaceIds: {},
		deletedSessionsByWorkspace: {},
		status: "connected",
		connectionGeneration: 3,
		protocolVersion: MCP_PROTOCOL_VERSION,
		activeLogin: null,
	});
});

test("the generation guard drops a snapshot that is not newer, unless it comes from a newer connection", () => {
	const current = held(snapshot("s", 5), 1);
	expect(isNewerMcpSnapshot(undefined, snapshot("s", 1), 1)).toBe(true);
	expect(isNewerMcpSnapshot(current, snapshot("s", 6), 1)).toBe(true);
	expect(isNewerMcpSnapshot(current, snapshot("s", 5), 1)).toBe(false);
	expect(isNewerMcpSnapshot(current, snapshot("s", 4), 1)).toBe(false);
	expect(isNewerMcpSnapshot(current, snapshot("s", 1), 2)).toBe(true);
});

test("a server keeps the time it was first seen starting until it leaves that state", () => {
	const first = held(snapshot("s", 1, [status("docs", "starting", 100)]));
	const second = foldMcpSnapshot(first, snapshot("s", 2, [status("docs", "starting", 900)]), 1, 1);
	expect(second?.startingSince).toEqual({ docs: 100 });
	const connected = foldMcpSnapshot(second ?? undefined, snapshot("s", 3), 1, 2);
	expect(connected?.startingSince).toEqual({});
	const restarted = foldMcpSnapshot(
		first,
		snapshot("s", 1, [status("docs", "starting", 500)]),
		2,
		3,
	);
	expect(restarted?.startingSince).toEqual({ docs: 500 });
});

test("a list replaces the live-chat set but keeps newer pushes and pushes that landed during the read", () => {
	const read = { workspaceId, connectionGeneration: 1, revision: 4 };
	const projection = {
		servers: null,
		configErrors: [],
		handledElsewhere: null,
		sessions: {
			gone: held(snapshot("gone", 2), 1, 3),
			ahead: held(snapshot("ahead", 9), 1, 3),
			late: held(snapshot("late", 1), 1, 5),
			stale: held(snapshot("stale", 1), 1, 2),
		},
	};
	const next = foldMcpList(
		projection,
		{
			servers: [],
			statuses: [
				snapshot("ahead", 8),
				snapshot("stale", 2),
				snapshot("fresh", 1),
				{ ...snapshot("other", 1), workspaceId: "elsewhere" },
			],
			handledElsewhere: { by: "custom-mcp" },
			configErrors: [{ source: "/agent/mcp.json", message: "bad JSON" }],
		},
		read,
	);
	expect(Object.keys(next.sessions).sort()).toEqual(["ahead", "fresh", "late", "stale"]);
	expect(next.sessions.ahead?.snapshot.generation).toBe(9);
	expect(next.sessions.stale?.snapshot.generation).toBe(2);
	expect(next.sessions.fresh?.revision).toBe(4);
	expect(next.handledElsewhere).toEqual({ by: "custom-mcp" });
	expect(next.configErrors).toEqual([{ source: "/agent/mcp.json", message: "bad JSON" }]);
	expect(foldMcpList(next, list([]), read).configErrors).toEqual([]);
});

test("status pushes install atomically behind the guard and only for live, supported scopes", () => {
	state().applyMcpStatus(snapshot("s", 2));
	expect(state().mcpRevision).toBe(1);
	state().applyMcpStatus(snapshot("s", 1));
	expect(state().mcpByWorkspace[workspaceId]?.sessions.s?.snapshot.generation).toBe(2);
	expect(state().mcpRevision).toBe(1);
	state().deleteChat(workspaceId, "s");
	expect(state().mcpByWorkspace[workspaceId]?.sessions.s).toBeUndefined();
	state().applyMcpStatus(snapshot("s", 3));
	expect(state().mcpByWorkspace[workspaceId]?.sessions.s).toBeUndefined();
	useAppStore.setState({ status: "disconnected" });
	state().applyMcpStatus(snapshot("t", 1));
	expect(state().mcpByWorkspace[workspaceId]?.sessions.t).toBeUndefined();
});

test("a list installs only for the connection it was read on and never resurrects a deleted chat", () => {
	const read = selectMcpRead(state(), workspaceId);
	expect(read).toEqual({ workspaceId, connectionGeneration: 3, revision: 0 });
	if (!read) throw new Error("expected a read token");
	state().deleteChat(workspaceId, "deleted");
	state().installMcpList(read, list([snapshot("deleted", 1), snapshot("live", 1)]));
	expect(Object.keys(state().mcpByWorkspace[workspaceId]?.sessions ?? {})).toEqual(["live"]);
	state().setStatus("connected");
	useAppStore.setState({ protocolVersion: MCP_PROTOCOL_VERSION });
	state().installMcpList(read, list([snapshot("next", 1)]));
	expect(state().mcpByWorkspace[workspaceId]?.sessions.next).toBeUndefined();
});

test("an older host has no MCP reads, its welcome clears the slice, and workspace removal drops it", () => {
	state().applyMcpStatus(snapshot("s", 1));
	state().installWelcomeSnapshot(MCP_PROTOCOL_VERSION, [], []);
	expect(state().mcpByWorkspace[workspaceId]).toBeDefined();
	state().installWelcomeSnapshot(MCP_PROTOCOL_VERSION - 1, [], []);
	expect(state().mcpByWorkspace).toEqual({});
	expect(selectMcpRead(state(), workspaceId)).toBeNull();
	useAppStore.setState({ protocolVersion: MCP_PROTOCOL_VERSION });
	state().applyMcpStatus(snapshot("s", 1));
	state().applyWorkspaceRemoved("project", workspaceId);
	expect(state().mcpByWorkspace[workspaceId]).toBeUndefined();
	expect(selectMcpRead(state(), workspaceId)).toBeNull();
});

test("an MCP sign-in keeps its target whether the frame or the start response arrives first", () => {
	const target = { kind: "mcp" as const, workspaceId, serverName: "linear" };
	state().applyLoginFrame({
		loginId: "mcplogin_1",
		providerId: "mcp:linear",
		frame: { kind: "progress", message: "Contacting the server…" },
		target,
	});
	state().beginLogin("mcplogin_1", "mcp:linear", target);
	expect(state().activeLogin).toMatchObject({ loginId: "mcplogin_1", target, status: "active" });
	state().clearLogin();
	state().beginLogin("provider-1", "anthropic");
	expect(state().activeLogin?.target).toBeUndefined();
});
