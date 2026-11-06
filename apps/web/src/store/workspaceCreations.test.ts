import { beforeEach, expect, test } from "bun:test";
import type { Workspace, WorkspaceCreation } from "@thinkrail/contracts";
import { useAppStore } from "./appStore";

const creation = (over: Partial<WorkspaceCreation> = {}): WorkspaceCreation => ({
	id: "c1",
	projectId: "p1",
	name: "workspace-5",
	branch: "workspace-5",
	baseBranch: "origin/main",
	state: "running",
	phase: "checking-out",
	startedAt: 1,
	...over,
});

const workspace: Workspace = {
	id: "c1",
	projectId: "p1",
	name: "workspace-5",
	branch: "workspace-5",
	worktreePath: "/w/workspace-5",
	baseBranch: "origin/main",
};

beforeEach(() => {
	useAppStore.setState({
		workspaceCreations: {},
		activeCreationId: null,
		creationChatToOpen: null,
		sentCreationPrompts: {},
		workspaceRetryDraft: null,
		activeWorkspaceId: null,
		selectedProjectId: null,
		removedWorkspaceIds: {},
		workspaces: { p1: [] },
		toasts: [],
	});
});

test("selecting a creation clears the active workspace, and activating a workspace clears it", () => {
	const store = useAppStore.getState();
	store.applyWorkspaceCreation(creation());
	store.activateWorkspace({ id: "w0", projectId: "p1" });
	store.selectCreation("c1");
	expect(useAppStore.getState()).toMatchObject({
		activeCreationId: "c1",
		activeWorkspaceId: null,
		selectedProjectId: "p1",
	});

	store.activateWorkspace({ id: "w0", projectId: "p1" });
	expect(useAppStore.getState().activeCreationId).toBeNull();
	store.selectCreation("c1");
	store.selectProject("p1");
	expect(useAppStore.getState().activeCreationId).toBeNull();
});

test("a finished active creation becomes the active workspace and queues its chat", () => {
	const store = useAppStore.getState();
	store.applyWorkspaceCreation(creation());
	store.selectCreation("c1");
	store.applyWorkspaceCreationRemoved({ id: "c1", projectId: "p1", workspace, sessionId: "s1" });

	const state = useAppStore.getState();
	expect(state.workspaceCreations).toEqual({});
	expect(state.activeCreationId).toBeNull();
	expect(state.activeWorkspaceId).toBe("c1");
	expect(state.consumeCreationChat()).toEqual({ workspaceId: "c1", sessionId: "s1" });
	expect(useAppStore.getState().creationChatToOpen).toBeNull();
});

test("a creation finishing in the background neither steals focus nor opens a chat", () => {
	const store = useAppStore.getState();
	store.applyWorkspaceCreation(creation());
	store.activateWorkspace({ id: "w0", projectId: "p1" });
	store.applyWorkspaceCreationRemoved({ id: "c1", projectId: "p1", workspace, sessionId: "s1" });
	expect(useAppStore.getState()).toMatchObject({
		activeWorkspaceId: "w0",
		creationChatToOpen: null,
		workspaceCreations: {},
	});
});

test("a kickoff rejected while the user is elsewhere still raises a toast", () => {
	const store = useAppStore.getState();
	store.applyWorkspaceCreation(creation());
	store.applyWorkspaceCreationRemoved({
		id: "c1",
		projectId: "p1",
		workspace,
		sessionId: "s1",
		kickoffError: "No API key found",
	});
	expect(useAppStore.getState().toasts[0]).toMatchObject({
		variant: "error",
		message: "No API key found",
	});
	expect(useAppStore.getState().creationChatToOpen).toBeNull();
});

test("dismissing the active creation lands on its project", () => {
	const store = useAppStore.getState();
	store.applyWorkspaceCreation(creation({ state: "failed", failure: { message: "boom" } }));
	store.selectCreation("c1");
	store.applyWorkspaceCreationRemoved({ id: "c1", projectId: "p1" });
	expect(useAppStore.getState()).toMatchObject({
		activeCreationId: null,
		activeWorkspaceId: null,
		selectedProjectId: "p1",
	});
});

test("a running creation that fails raises one error toast with git's reason", () => {
	const store = useAppStore.getState();
	store.applyWorkspaceCreation(creation());
	store.applyWorkspaceCreation(creation({ state: "failed", failure: { message: "disk full" } }));
	store.applyWorkspaceCreation(creation({ state: "failed", failure: { message: "disk full" } }));
	const toasts = useAppStore.getState().toasts;
	expect(toasts).toHaveLength(1);
	expect(toasts[0]).toMatchObject({ variant: "error", message: "disk full" });
});

test("hydration replaces the creations and frees prompts of creations that are gone", () => {
	const store = useAppStore.getState();
	store.applyWorkspaceCreation(creation(), { text: "held", attachments: [] });
	store.applyWorkspaceCreation(creation({ id: "c2" }), { text: "kept", attachments: [] });
	store.setWorkspaceCreations([creation({ id: "c2" })]);
	expect(Object.keys(useAppStore.getState().workspaceCreations)).toEqual(["c2"]);
	expect(Object.keys(useAppStore.getState().sentCreationPrompts)).toEqual(["c2"]);
});

test("a watched creation that finished during a disconnect lands on its workspace", () => {
	const store = useAppStore.getState();
	store.applyWorkspaceCreation(creation());
	store.selectCreation("c1");
	useAppStore.setState({ workspaces: { p1: [workspace] } });
	store.setWorkspaceCreations([]);
	expect(useAppStore.getState()).toMatchObject({ activeCreationId: null, activeWorkspaceId: "c1" });
});

test("a watched creation finished during a disconnect lands on its workspace once the list loads", () => {
	const store = useAppStore.getState();
	store.applyWorkspaceCreation(creation());
	store.selectCreation("c1");
	store.setWorkspaceCreations([]);
	expect(useAppStore.getState().selectedProjectId).toBe("p1");
	useAppStore.setState({ workspaces: { p1: [workspace] } });
	store.landOnFinishedCreation("p1", "c1");
	expect(useAppStore.getState().activeWorkspaceId).toBe("c1");
});

test("landing never overrides a selection the user made meanwhile", () => {
	const store = useAppStore.getState();
	useAppStore.setState({ workspaces: { p1: [workspace] } });
	store.activateWorkspace({ id: "w0", projectId: "p1" });
	store.landOnFinishedCreation("p1", "c1");
	expect(useAppStore.getState().activeWorkspaceId).toBe("w0");
});

test("a watched creation dismissed during a disconnect lands on its project", () => {
	const store = useAppStore.getState();
	store.applyWorkspaceCreation(creation());
	store.selectCreation("c1");
	store.setWorkspaceCreations([]);
	expect(useAppStore.getState()).toMatchObject({
		activeCreationId: null,
		activeWorkspaceId: null,
		selectedProjectId: "p1",
	});
});
