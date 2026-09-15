import { beforeEach, expect, test } from "bun:test";
import type { BackgroundCommandSummary, SessionResources } from "@thinkrail/contracts";
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
		protocolVersion: 65,
	});
});

test("selectors count stopping commands and queued children, keeping terminal groups separate", () => {
	const groups = selectChatResourceGroups(snapshot);
	expect(groups.activeCount).toBe(4);
	expect(groups.commands.map((item) => item.status)).toEqual(["running", "stopping"]);
	expect(groups.subagents.map((item) => item.status)).toEqual(["queued", "running"]);
	expect(groups.finishedCommands.map((item) => item.status)).toEqual([
		"completed",
		"error",
		"stopped",
	]);
	expect(groups.finishedSubagents.map((item) => item.status)).toEqual([
		"completed",
		"error",
		"aborted",
	]);
	expect(selectChatResourceGroups(null).activeCount).toBe(0);
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
	state().installWelcomeSnapshot(65, [], []);
	state().installChatResources(first, snapshot);
	expect(selectChatResourceAuthority(state(), scope)).toBe(false);
	state().invalidateChatResources(scope);
	state().installChatResources(read(), snapshot);
	expect(selectChatResourceAuthority(state(), scope)).toBe(true);
	const current = read();
	state().installWelcomeSnapshot(64, [], []);
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
