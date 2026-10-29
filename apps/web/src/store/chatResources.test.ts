import { beforeEach, expect, test } from "bun:test";
import {
	type BackgroundCommandSummary,
	CHAT_RESOURCES_PROTOCOL_VERSION,
	type SessionResources,
} from "@thinkrail/contracts";
import {
	selectChatResourceAuthority,
	selectChatResourceGroups,
	selectChatResourceProjection,
	useAppStore,
} from "./index";

const scope = { workspaceId: "resources-workspace", sessionId: "resources-session" };
const command = (status: BackgroundCommandSummary["status"]): BackgroundCommandSummary => ({
	id: status,
	sessionId: scope.sessionId,
	name: status,
	command: "echo hello",
	status,
	startedAt: 1,
});
const snapshot: SessionResources = {
	...scope,
	commands: [
		command("running"),
		command("stopping"),
		command("completed"),
		command("error"),
		command("stopped"),
	],
	subagents: ["queued", "running", "completed", "error", "aborted"].map((status) => ({
		childSessionId: status,
		parentSessionId: scope.sessionId,
		task: "inspect",
		createdAt: "2026-01-01",
		status,
	})) as SessionResources["subagents"],
};
const state = useAppStore.getState;
const projection = () => selectChatResourceProjection(state(), scope);
const read = () => ({
	...scope,
	connectionGeneration: state().connectionGeneration,
	revision: projection()?.revision ?? -1,
});

beforeEach(() => {
	useAppStore.setState({
		resourceSnapshots: {},
		resourceRevision: 0,
		removedWorkspaceIds: {},
		deletedSessionsByWorkspace: {},
		status: "connected",
		connectionGeneration: 4,
		protocolVersion: CHAT_RESOURCES_PROTOCOL_VERSION,
	});
});

test("selectors count stopping commands and queued children, keeping terminal groups separate", () => {
	const groups = selectChatResourceGroups(snapshot);
	expect(groups.activeCount).toBe(4);
	expect(groups.commands.map((item) => item.status)).toEqual(["running", "stopping"]);
	expect(groups.subagents.map((item) => item.status)).toEqual(["queued", "running"]);
	expect(groups.finishedCommands.map((item) => item.status).sort()).toEqual([
		"completed",
		"error",
		"stopped",
	]);
	expect(groups.finishedSubagents.map((item) => item.status).sort()).toEqual([
		"aborted",
		"completed",
		"error",
	]);
	expect(selectChatResourceGroups(null).activeCount).toBe(0);
});

test("finished totals come from the host's history, else from the snapshot an older host sent", () => {
	expect(selectChatResourceGroups(snapshot).history).toEqual({
		commands: { done: 0, failed: 2, stopped: 1, interrupted: 0 },
		subagents: { done: 1, failed: 1, stopped: 1, interrupted: 0 },
	});
	expect(selectChatResourceGroups(snapshot).finishedCount).toBe(6);
	const history = {
		commands: { done: 60, failed: 2, stopped: 1, interrupted: 1 },
		subagents: { done: 20, failed: 0, stopped: 2, interrupted: 0 },
	};
	const groups = selectChatResourceGroups({ ...snapshot, history });
	expect(groups.history).toBe(history);
	expect(groups.finishedCount).toBe(86);
});

test("an interrupted run is never live, whatever status it last reported", () => {
	const groups = selectChatResourceGroups({
		...snapshot,
		commands: [{ ...command("running"), interrupted: true }],
		subagents: [],
	});
	expect(groups.commands).toEqual([]);
	expect(groups.finishedCommands).toHaveLength(1);
	expect(groups.history.commands.interrupted).toBe(1);
});

test("paged history continues the chain it was asked from, rides along new windows, and is dropped when it no longer touches them", () => {
	const done = (id: string, finishedAt: number) => ({
		...command("completed"),
		id,
		exitCode: 0,
		finishedAt,
	});
	const page = (...items: ReturnType<typeof done>[]) =>
		items.map((summary) => ({ kind: "command" as const, summary }));
	const history = {
		commands: { done: 7, failed: 0, stopped: 0, interrupted: 0 },
		subagents: { done: 0, failed: 0, stopped: 0, interrupted: 0 },
	};
	const windowed = (...items: ReturnType<typeof done>[]): SessionResources => ({
		...scope,
		commands: [command("running"), ...items],
		subagents: [],
		history,
	});
	const ids = () =>
		selectChatResourceGroups(
			projection()?.snapshot,
			true,
			projection()?.older,
		).finishedCommands.map((item) => item.id);
	const connection = () => ({ ...scope, connectionGeneration: state().connectionGeneration });

	state().invalidateChatResources(scope);
	state().installChatResources(read(), windowed(done("c1", 10), done("c2", 9), done("c3", 8)));
	state().appendChatResourceHistory(
		connection(),
		"command",
		"c3",
		page(done("c4", 7), done("c5", 6)),
	);
	expect(ids()).toEqual(["c1", "c2", "c3", "c4", "c5"]);
	const groups = selectChatResourceGroups(projection()?.snapshot, true, projection()?.older);
	expect(groups.recentFinished.finishedCommands.map((item) => item.id)).toEqual(["c1", "c2", "c3"]);
	expect(groups.remaining).toEqual({ command: 2, subagent: 0 });

	state().appendChatResourceHistory(connection(), "command", "c3", page(done("stale", 5)));
	expect(ids()).toEqual(["c1", "c2", "c3", "c4", "c5"]);

	state().invalidateChatResources(scope);
	expect(projection()?.older).toHaveLength(2);
	state().installChatResources(read(), windowed(done("c0", 11), done("c1", 10), done("c2", 9)));
	expect(ids()).toEqual(["c0", "c1", "c2", "c3", "c4", "c5"]);

	state().invalidateChatResources(scope);
	state().installChatResources(read(), windowed(done("x1", 30), done("x2", 29), done("x3", 28)));
	expect(ids()).toEqual(["x1", "x2", "x3"]);

	state().appendChatResourceHistory(connection(), "command", "x3", page(done("c0", 11)));
	expect(ids()).toEqual(["x1", "x2", "x3", "c0"]);
	state().setStatus("disconnected");
	state().setStatus("connected");
	state().installWelcomeSnapshot(CHAT_RESOURCES_PROTOCOL_VERSION, [], []);
	state().invalidateChatResources(scope);
	state().installChatResources(read(), windowed(done("x1", 30), done("x2", 29), done("x3", 28)));
	expect(ids()).toEqual(["x1", "x2", "x3"]);
});

test("atomic invalidation and installation preserve stale snapshots and reject old revisions", () => {
	state().invalidateChatResources(scope);
	const first = read();
	state().installChatResources(first, snapshot);
	expect(selectChatResourceAuthority(state(), scope)).toBe(true);
	state().invalidateChatResources(scope);
	expect(projection()?.snapshot).toBe(snapshot);
	expect(selectChatResourceAuthority(state(), scope)).toBe(false);
	state().installChatResources(first, { ...snapshot, commands: [] });
	state().failChatResources(first, "old error");
	expect(projection()?.snapshot).toBe(snapshot);
	expect(projection()?.error).toBeNull();
	state().failChatResources(read(), "read failed");
	expect(projection()).toMatchObject({ snapshot, fresh: false, error: "read failed" });
	state().installChatResources(read(), snapshot);
	expect(projection()).toMatchObject({ fresh: true, error: null });
});

test("workspace and session response identity cannot cross authority", () => {
	state().invalidateChatResources(scope);
	state().installChatResources(read(), { ...snapshot, sessionId: "foreign" });
	state().installChatResources(read(), { ...snapshot, workspaceId: "foreign" });
	expect(projection()?.snapshot).toBeNull();
});

test("disconnect preserves stale data; reconnect fences late responses and old hosts clear it", () => {
	state().invalidateChatResources(scope);
	const first = read();
	state().installChatResources(first, snapshot);
	state().setStatus("disconnected");
	expect(projection()).toMatchObject({ snapshot, fresh: false });
	expect(selectChatResourceAuthority(state(), scope)).toBe(false);
	state().setStatus("connected");
	state().installWelcomeSnapshot(CHAT_RESOURCES_PROTOCOL_VERSION, [], []);
	state().installChatResources(first, snapshot);
	expect(selectChatResourceAuthority(state(), scope)).toBe(false);
	state().invalidateChatResources(scope);
	state().installChatResources(read(), snapshot);
	expect(selectChatResourceAuthority(state(), scope)).toBe(true);
	const current = read();
	state().installWelcomeSnapshot(CHAT_RESOURCES_PROTOCOL_VERSION - 1, [], []);
	expect(state().resourceSnapshots).toEqual({});
	state().installChatResources(current, snapshot);
	expect(state().resourceSnapshots).toEqual({});
});

test("clear and rehydrate use distinct revisions so a late read cannot resurrect a projection", () => {
	state().invalidateChatResources(scope);
	const first = read();
	state().clearChatResources(scope);
	state().installChatResources(first, snapshot);
	expect(projection()).toBeUndefined();
	state().invalidateChatResources(scope);
	state().installChatResources(first, snapshot);
	expect(projection()?.snapshot).toBeNull();
	expect(read().revision).toBeGreaterThan(first.revision);
});

test("chat deletion and workspace removal clear projections and fence future arrivals", () => {
	for (const remove of [
		() => state().deleteChat(scope.workspaceId, scope.sessionId),
		() => state().applyWorkspaceRemoved("project", scope.workspaceId),
	]) {
		useAppStore.setState({ deletedSessionsByWorkspace: {}, removedWorkspaceIds: {} });
		state().invalidateChatResources(scope);
		const first = read();
		state().installChatResources(first, snapshot);
		remove();
		state().installChatResources(first, snapshot);
		state().invalidateChatResources(scope);
		expect(projection()).toBeUndefined();
	}
});
