import { afterEach, beforeEach, expect, test } from "bun:test";
import {
	ATTENTION_NAVIGATION_PROTOCOL_VERSION,
	type Project,
	type Workspace,
} from "@thinkrail/contracts";
import { useAppStore } from "../store";
import {
	type AttentionSessionNavigation,
	startAttentionSessionNavigation,
} from "./attentionNavigation";
import type { WorkspaceLayoutDocument } from "./layout";

function project(id: string): Project {
	return { id, name: id, path: `/tmp/${id}`, slug: id, lastOpened: 1 };
}

function workspace(id: string, projectId: string): Workspace {
	return {
		id,
		projectId,
		name: id,
		branch: id,
		worktreePath: `/tmp/${projectId}/${id}`,
		baseBranch: "main",
	};
}

function deferred<T>() {
	let resolve: (value: T) => void = () => {};
	let reject: (error: Error) => void = () => {};
	const promise = new Promise<T>((accept, fail) => {
		resolve = accept;
		reject = fail;
	});
	return { promise, resolve, reject };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function setAttention(
	entries: {
		projectId: string;
		workspaceId: string;
		sessionId: string;
		attentionId?: string;
		attentionPriority?: "blocking" | "normal";
		attentionAt: number;
	}[],
): void {
	const attentionByWorkspace: ReturnType<typeof useAppStore.getState>["attentionByWorkspace"] = {};
	for (const entry of entries) {
		const workspaceAttention = attentionByWorkspace[entry.workspaceId] ?? {
			projectId: entry.projectId,
			sessions: {},
		};
		workspaceAttention.sessions[entry.sessionId] = {
			attentionId: entry.attentionId ?? `candidate-${entry.sessionId}`,
			attentionPriority: entry.attentionPriority ?? "normal",
			attentionAt: entry.attentionAt,
			requiredConnectionGeneration: 1,
			requiredHydrationEpoch: 0,
			requiredEventRevision: 0,
		};
		attentionByWorkspace[entry.workspaceId] = workspaceAttention;
	}
	useAppStore.setState({ attentionByWorkspace });
}

function selectChat(targetWorkspace: Workspace, sessionId: string): void {
	const document: WorkspaceLayoutDocument = {
		version: 2,
		center: {
			kind: "group",
			id: "center",
			tabs: [{ kind: "chat", id: `chat:${sessionId}`, name: sessionId, sessionId }],
		},
		left: { visible: false, width: 0.2, groups: [] },
		right: { visible: false, width: 0.2, groups: [] },
		bottom: { visible: false, height: 0.3, alignment: "center", groups: [] },
		toolRestoreTargets: {},
	};
	useAppStore.setState({
		selectedProjectId: targetWorkspace.projectId,
		activeWorkspaceId: targetWorkspace.id,
		layoutDocumentsByWorkspace: { [targetWorkspace.id]: document },
		layoutAttentionByWorkspace: {
			[targetWorkspace.id]: {
				selectedByGroup: { center: `chat:${sessionId}` },
				lastFocusedCenterGroupId: "center",
				lastFocusedSideGroupId: {},
				navigationClockByGroup: { center: 0 },
			},
		},
	});
}

let navigation: AttentionSessionNavigation | null = null;

beforeEach(() => {
	useAppStore.setState({
		status: "connected",
		protocolVersion: ATTENTION_NAVIGATION_PROTOCOL_VERSION,
		connectionGeneration: 1,
		welcomeGeneration: 1,
		projects: [project("p1"), project("p2"), project("p3")],
		recentProjects: [project("p1"), project("p2"), project("p3")],
		workspaces: {},
		selectedProjectId: null,
		activeWorkspaceId: null,
		workspaceSelectionHistory: [],
		attentionByWorkspace: {},
		chatLocationRequest: null,
		layoutDocumentsByWorkspace: {},
		layoutAttentionByWorkspace: {},
		navTickByWorkspace: {},
		removedWorkspaceIds: {},
		deletedSessionsByWorkspace: {},
		toasts: [],
	});
});

afterEach(() => {
	navigation?.stop();
	navigation = null;
});

function start(listWorkspaces: (projectId: string) => Promise<Workspace[]> = async () => []) {
	const info: string[] = [];
	const errors: unknown[] = [];
	navigation = startAttentionSessionNavigation({
		listWorkspaces,
		onInfo: (message) => info.push(message),
		onError: (error) => errors.push(error),
	});
	return { navigation, info, errors };
}

test("no targets and an only-current target report distinct no-op states", () => {
	const w1 = workspace("w1", "p1");
	useAppStore.setState({ workspaces: { p1: [w1] } });
	const { navigation: navigator, info } = start();

	navigator.next();
	expect(info).toEqual(["No chats need attention."]);

	setAttention([{ projectId: "p1", workspaceId: "w1", sessionId: "s1", attentionAt: 10 }]);
	selectChat(w1, "s1");
	navigator.previous();
	expect(info).toEqual(["No chats need attention.", "This is the only chat needing attention."]);
	expect(useAppStore.getState().chatLocationRequest).toBeNull();
});

test("a viewed normal candidate disappears without restarting ahead of the remaining normal work", () => {
	const w1 = workspace("w1", "p1");
	useAppStore.setState({ workspaces: { p1: [w1] } });
	setAttention([
		{
			projectId: "p1",
			workspaceId: "w1",
			sessionId: "blocker",
			attentionPriority: "blocking",
			attentionAt: 30,
		},
		{
			projectId: "p1",
			workspaceId: "w1",
			sessionId: "normal-new",
			attentionAt: 20,
		},
		{
			projectId: "p1",
			workspaceId: "w1",
			sessionId: "normal-old",
			attentionAt: 10,
		},
	]);
	const { navigation: navigator } = start();

	navigator.next();
	selectChat(w1, "blocker");
	useAppStore.getState().clearChatLocation();
	navigator.next();
	expect(useAppStore.getState().chatLocationRequest?.sessionId).toBe("normal-new");

	selectChat(w1, "normal-new");
	useAppStore.getState().clearChatLocation();
	setAttention([
		{
			projectId: "p1",
			workspaceId: "w1",
			sessionId: "blocker",
			attentionPriority: "blocking",
			attentionAt: 30,
		},
		{
			projectId: "p1",
			workspaceId: "w1",
			sessionId: "normal-old",
			attentionAt: 10,
		},
	]);
	navigator.next();
	expect(useAppStore.getState().chatLocationRequest?.sessionId).toBe("normal-old");
});

test("a known target dispatches an exact open-chat request synchronously", () => {
	const w2 = workspace("w2", "p2");
	useAppStore.setState({ workspaces: { p2: [w2] } });
	setAttention([{ projectId: "p2", workspaceId: "w2", sessionId: "s2", attentionAt: 20 }]);
	const { navigation: navigator } = start();

	navigator.next();
	expect(useAppStore.getState().activeWorkspaceId).toBe("w2");
	expect(useAppStore.getState().chatLocationRequest).toMatchObject({
		kind: "open-chat",
		projectId: "p2",
		workspaceId: "w2",
		sessionId: "s2",
	});
});

test("a cold cross-project target waits for authoritative workspace membership", async () => {
	const w1 = workspace("w1", "p1");
	const w2 = workspace("w2", "p2");
	useAppStore.setState({ workspaces: { p1: [w1] } });
	selectChat(w1, "idle");
	setAttention([{ projectId: "p2", workspaceId: "w2", sessionId: "s2", attentionAt: 20 }]);
	const pending = deferred<Workspace[]>();
	const calls: string[] = [];
	const { navigation: navigator } = start((projectId) => {
		calls.push(projectId);
		return pending.promise;
	});

	navigator.next();
	expect(calls).toEqual(["p2"]);
	expect(useAppStore.getState().chatLocationRequest).toBeNull();
	expect(useAppStore.getState().activeWorkspaceId).toBe("w1");

	pending.resolve([w2]);
	await settle();
	expect(useAppStore.getState().workspaces.p2).toEqual([w2]);
	expect(useAppStore.getState().chatLocationRequest).toMatchObject({
		kind: "open-chat",
		workspaceId: "w2",
		sessionId: "s2",
	});
});

test("rapid presses advance the pending cursor and only the latest cold read may dispatch", async () => {
	const w2 = workspace("w2", "p2");
	const w3 = workspace("w3", "p3");
	setAttention([
		{ projectId: "p2", workspaceId: "w2", sessionId: "newer", attentionAt: 30 },
		{ projectId: "p3", workspaceId: "w3", sessionId: "older", attentionAt: 20 },
	]);
	const p2 = deferred<Workspace[]>();
	const p3 = deferred<Workspace[]>();
	const { navigation: navigator } = start((projectId) =>
		projectId === "p2" ? p2.promise : p3.promise,
	);

	navigator.next();
	navigator.next();
	p2.resolve([w2]);
	await settle();
	expect(useAppStore.getState().chatLocationRequest).toBeNull();

	p3.resolve([w3]);
	await settle();
	expect(useAppStore.getState().chatLocationRequest).toMatchObject({
		kind: "open-chat",
		workspaceId: "w3",
		sessionId: "older",
	});
});

test("stale attention for a closed project is skipped instead of reopening its scope", async () => {
	const w1 = workspace("w1", "p1");
	const w2 = workspace("w2", "p2");
	useAppStore.setState({
		projects: [project("p1")],
		workspaces: { p1: [w1], p2: [w2] },
	});
	setAttention([
		{ projectId: "p2", workspaceId: "w2", sessionId: "closed", attentionAt: 30 },
		{ projectId: "p1", workspaceId: "w1", sessionId: "open", attentionAt: 20 },
	]);
	const { navigation: navigator } = start();

	navigator.next();
	expect(useAppStore.getState().chatLocationRequest).toMatchObject({
		kind: "open-chat",
		workspaceId: "w1",
		sessionId: "open",
	});
});

test("skipping an invalid opaque-id target cannot alias another candidate", async () => {
	const valid = workspace("c", "a\u0000b");
	useAppStore.setState({
		projects: [project("a"), project("a\u0000b")],
		workspaces: { "a\u0000b": [valid] },
	});
	setAttention([
		{
			projectId: "a",
			workspaceId: "b\u0000c",
			sessionId: "d",
			attentionAt: 30,
		},
		{
			projectId: "a\u0000b",
			workspaceId: "c",
			sessionId: "d",
			attentionAt: 20,
		},
	]);
	const { navigation: navigator } = start();

	navigator.next();
	await settle();
	expect(useAppStore.getState().chatLocationRequest).toMatchObject({
		kind: "open-chat",
		projectId: "a\u0000b",
		workspaceId: "c",
		sessionId: "d",
	});
});

test("a target that retracts during membership loading is skipped", async () => {
	const w1 = workspace("w1", "p1");
	const w2 = workspace("w2", "p2");
	useAppStore.setState({ workspaces: { p1: [w1] } });
	setAttention([
		{ projectId: "p2", workspaceId: "w2", sessionId: "gone", attentionAt: 30 },
		{ projectId: "p1", workspaceId: "w1", sessionId: "next", attentionAt: 20 },
	]);
	const pending = deferred<Workspace[]>();
	const { navigation: navigator } = start(() => pending.promise);

	navigator.next();
	setAttention([{ projectId: "p1", workspaceId: "w1", sessionId: "next", attentionAt: 20 }]);
	pending.resolve([w2]);
	await settle();
	expect(useAppStore.getState().chatLocationRequest).toMatchObject({
		kind: "open-chat",
		workspaceId: "w1",
		sessionId: "next",
	});
});

test("user navigation cancels both a membership read and an already-dispatched open", async () => {
	const w1 = workspace("w1", "p1");
	const w2 = workspace("w2", "p2");
	const w3 = workspace("w3", "p3");
	useAppStore.setState({ workspaces: { p1: [w1], p3: [w3] } });
	setAttention([{ projectId: "p2", workspaceId: "w2", sessionId: "s2", attentionAt: 20 }]);
	const pending = deferred<Workspace[]>();
	const { navigation: navigator } = start(() => pending.promise);

	navigator.next();
	useAppStore.getState().activateWorkspace(w3);
	pending.resolve([w2]);
	await settle();
	expect(useAppStore.getState().activeWorkspaceId).toBe("w3");
	expect(useAppStore.getState().chatLocationRequest).toBeNull();

	useAppStore.setState({ workspaces: { p1: [w1], p2: [w2], p3: [w3] } });
	navigator.next();
	expect(useAppStore.getState().chatLocationRequest?.sessionId).toBe("s2");
	useAppStore.getState().activateWorkspace(w1);
	expect(useAppStore.getState().activeWorkspaceId).toBe("w1");
	expect(useAppStore.getState().chatLocationRequest).toBeNull();
});

test("workspace-list failure keeps the current location and reports the error", async () => {
	const w1 = workspace("w1", "p1");
	useAppStore.setState({ workspaces: { p1: [w1] } });
	selectChat(w1, "idle");
	setAttention([{ projectId: "p2", workspaceId: "w2", sessionId: "s2", attentionAt: 20 }]);
	const pending = deferred<Workspace[]>();
	const { navigation: navigator, errors } = start(() => pending.promise);

	navigator.next();
	const failure = new Error("offline");
	pending.reject(failure);
	await settle();
	expect(useAppStore.getState().activeWorkspaceId).toBe("w1");
	expect(useAppStore.getState().chatLocationRequest).toBeNull();
	expect(errors).toEqual([failure]);
});

test("an unsupported or disconnected surface does not claim navigation", () => {
	setAttention([{ projectId: "p2", workspaceId: "w2", sessionId: "s2", attentionAt: 20 }]);
	const { navigation: navigator, info } = start();
	useAppStore.setState({ protocolVersion: ATTENTION_NAVIGATION_PROTOCOL_VERSION - 1 });
	navigator.next();
	useAppStore.setState({
		protocolVersion: ATTENTION_NAVIGATION_PROTOCOL_VERSION,
		status: "disconnected",
	});
	navigator.next();
	expect(useAppStore.getState().chatLocationRequest).toBeNull();
	expect(info).toEqual([]);
});
