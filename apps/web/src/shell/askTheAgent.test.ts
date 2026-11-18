import { afterAll, beforeEach, expect, mock, test } from "bun:test";
import type { Project, Workspace } from "@thinkrail/contracts";

const requests: { method: string; params: unknown }[] = [];
const project: Project = { id: "p1", name: "repo", path: "/repo", slug: "repo", lastOpened: 0 };
const defaultRow: Workspace = {
	id: "w-default",
	projectId: "p1",
	name: "Default",
	kind: "default",
	branch: "main",
	baseBranch: "main",
	worktreePath: "/repo",
};
const actualTransport = await import("../transport");
mock.module("../transport", () => ({
	...actualTransport,
	getTransport: () => ({
		request: (method: string, params: unknown) => {
			requests.push({ method, params });
			return method === "workspace.list" ? Promise.resolve([defaultRow]) : new Promise(() => {});
		},
	}),
}));

const { useAppStore } = await import("../store");
const { askTheAgent } = await import("./useSearchPalette");
const initial = useAppStore.getInitialState();
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
	requests.length = 0;
	useAppStore.setState(initial, true);
	useAppStore.setState({ projects: [project], welcomeGeneration: 1 });
});
afterAll(() => useAppStore.setState(initial, true));

test("an ask from Project Home that a later pick overtook enters nothing and starts no chat", async () => {
	await askTheAgent(null, "p1", "Where are titles written?", () => false);
	await settle();
	expect(useAppStore.getState().activeWorkspaceId).toBeNull();
	expect(useAppStore.getState().chatStartsByWorkspace["w-default"]).toBeUndefined();
	expect(requests.map((request) => request.method)).toEqual(["workspace.list"]);
});

test("an ask from Project Home that still stands enters the Default and asks there", async () => {
	void askTheAgent(null, "p1", "Where are titles written?", () => true);
	await settle();
	expect(useAppStore.getState().activeWorkspaceId).toBe("w-default");
	expect(useAppStore.getState().chatStartsByWorkspace["w-default"]).toBe(1);
});
