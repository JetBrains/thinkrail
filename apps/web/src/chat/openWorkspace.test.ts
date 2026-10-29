import { afterAll, beforeEach, expect, mock, test } from "bun:test";
import type { Project, Workspace } from "@thinkrail/contracts";

const requests: { method: string; params: unknown }[] = [];
let reply: () => Promise<unknown> = () => Promise.resolve([]);
const actualTransport = await import("../transport");
mock.module("../transport", () => ({
	...actualTransport,
	getTransport: () => ({
		request: (method: string, params: unknown) => {
			requests.push({ method, params });
			return reply();
		},
	}),
}));

const { useAppStore } = await import("../store");
const { openWorkspace } = await import("./openWorkspace");

const workspace = (id: string, projectId: string): Workspace => ({
	id,
	projectId,
	name: id,
	branch: id,
	worktreePath: `/wt/${id}`,
	baseBranch: "main",
});

const project = (id: string): Project => ({
	id,
	name: id,
	path: `/${id}`,
	slug: id,
	lastOpened: 0,
});

beforeEach(() => {
	requests.length = 0;
	reply = () => Promise.resolve([]);
	useAppStore.setState(useAppStore.getInitialState(), true);
	useAppStore.setState({
		projects: [project("p1"), project("p2")],
		workspaces: { p1: [workspace("w1", "p1")] },
		welcomeGeneration: 1,
	});
});

afterAll(() => useAppStore.setState(useAppStore.getInitialState(), true));

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const opened = () => {
	const state = useAppStore.getState();
	return {
		projectId: state.selectedProjectId,
		workspaceId: state.activeWorkspaceId,
		sessionId: state.routeChatTarget?.sessionId ?? null,
	};
};

test("a workspace the store holds opens at once, under its own project", () => {
	openWorkspace({ workspaceId: "w1", projectId: "stale", sessionId: "s1" });
	expect(requests).toEqual([]);
	expect(opened()).toEqual({ projectId: "p1", workspaceId: "w1", sessionId: "s1" });
});

test("an unknown workspace loads its project's list first, then opens", async () => {
	reply = () => Promise.resolve([workspace("w9", "p2")]);
	openWorkspace({ workspaceId: "w9", projectId: "p2", sessionId: "s9" });
	expect(opened().workspaceId).not.toBe("w9");
	await settle();
	expect(requests).toEqual([{ method: "workspace.list", params: { projectId: "p2" } }]);
	expect(useAppStore.getState().workspaces.p2?.map((row) => row.id)).toEqual(["w9"]);
	expect(opened()).toEqual({ projectId: "p2", workspaceId: "w9", sessionId: "s9" });
});

test("an unknown workspace no list shows, or a list that failed, opens nothing and the user is told", async () => {
	const nothing = { projectId: null, workspaceId: null, sessionId: null };
	expect(await openWorkspace({ workspaceId: "w9", projectId: "p2" }, "gone")).toBe(false);
	expect(opened()).toEqual(nothing);
	expect(useAppStore.getState().toasts.at(-1)?.message).toBe("gone");

	reply = () => Promise.reject(new Error("offline"));
	expect(await openWorkspace({ workspaceId: "w9", projectId: "p2" })).toBe(false);
	expect(opened()).toEqual(nothing);
	expect(useAppStore.getState().toasts.at(-1)?.message).toBe("offline");

	reply = () => Promise.resolve([workspace("w9", "p2")]);
	const closing = openWorkspace({ workspaceId: "w9", projectId: "p2" }, "closed");
	useAppStore.setState({ projects: [project("p1")] });
	expect(await closing).toBe(false);
	expect(opened()).toEqual(nothing);

	useAppStore.setState({ projects: [project("p1"), project("p2")] });
	const reconnecting = openWorkspace({ workspaceId: "w9", projectId: "p2" });
	useAppStore.setState({ welcomeGeneration: 2 });
	expect(await reconnecting).toBeNull();
	expect(opened()).toEqual(nothing);
});

test("a held workspace whose project was closed is not opened, and the user is told", async () => {
	useAppStore.setState({ projects: [project("p2")] });
	expect(await openWorkspace({ workspaceId: "w1", projectId: "p1", sessionId: "s1" }, "gone")).toBe(
		false,
	);
	expect(requests).toEqual([]);
	expect(opened()).toEqual({ projectId: null, workspaceId: null, sessionId: null });
	expect(useAppStore.getState().toasts.at(-1)?.message).toBe("gone");
});

test("a workspace being deleted is never opened, held or just listed", async () => {
	useAppStore.setState({
		workspaces: { p1: [{ ...workspace("w1", "p1"), deletionPending: true }] },
	});
	expect(await openWorkspace({ workspaceId: "w1", projectId: "p1" }, "gone")).toBe(false);
	reply = () => Promise.resolve([{ ...workspace("w9", "p2"), deletionPending: true }]);
	expect(await openWorkspace({ workspaceId: "w9", projectId: "p2" }, "gone")).toBe(false);
	expect(useAppStore.getState().activeWorkspaceId).toBeNull();
	expect(useAppStore.getState().toasts.at(-1)?.message).toBe("gone");
});

test("an open the user navigated away from, or a newer open overtook, opens nothing and says nothing", async () => {
	reply = () => Promise.resolve([workspace("w9", "p2")]);
	const overtaken = openWorkspace({ workspaceId: "w9", projectId: "p2", sessionId: "s9" });
	useAppStore.getState().activateWorkspaceFromRoute(workspace("w1", "p1"));
	expect(await overtaken).toBe(false);
	expect(opened()).toEqual({ projectId: "p1", workspaceId: "w1", sessionId: null });

	const toasts = useAppStore.getState().toasts.length;
	reply = () => Promise.reject(new Error("offline"));
	const failed = openWorkspace({ workspaceId: "w9", projectId: "p2" });
	useAppStore.getState().selectMain();
	expect(await failed).toBe(false);
	expect(useAppStore.getState().toasts).toHaveLength(toasts);

	reply = () => Promise.resolve([workspace("w9", "p2"), workspace("w8", "p2")]);
	const older = openWorkspace({ workspaceId: "w9", projectId: "p2" });
	const newer = openWorkspace({ workspaceId: "w8", projectId: "p2" });
	expect(await older).toBe(false);
	expect(await newer).toBe(true);
	expect(opened()).toEqual({ projectId: "p2", workspaceId: "w8", sessionId: null });
	expect(useAppStore.getState().toasts).toHaveLength(toasts);
});
