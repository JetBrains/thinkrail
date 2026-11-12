import { afterAll, beforeEach, expect, mock, test } from "bun:test";
import type { Project, Workspace } from "@thinkrail/contracts";

const listed: string[] = [];
const rowsByProject: Record<string, Workspace[]> = {};
const actualTransport = await import("../transport");
mock.module("../transport", () => ({
	...actualTransport,
	getTransport: () => ({
		request: (method: string, params: { projectId: string }) => {
			if (method !== "workspace.list") return Promise.reject(new Error(method));
			listed.push(params.projectId);
			const rows = rowsByProject[params.projectId];
			return rows ? Promise.resolve(rows) : Promise.reject(new Error("unreachable"));
		},
	}),
}));

const { useAppStore } = await import("../store");
const { resolveOpenWorkspaceForPath } = await import("./workspaceForPath");
const initial = useAppStore.getInitialState();

const project = (id: string, path: string): Project => ({
	id,
	name: id,
	path,
	slug: id,
	lastOpened: 0,
});
const row = (id: string, projectId: string, worktreePath: string): Workspace => ({
	id,
	projectId,
	name: id,
	branch: id,
	baseBranch: "main",
	worktreePath,
});

beforeEach(() => {
	listed.length = 0;
	for (const key of Object.keys(rowsByProject)) delete rowsByProject[key];
	useAppStore.setState(initial, true);
});
afterAll(() => useAppStore.setState(initial, true));

test("lists an enclosing nested project before trusting an already loaded parent", async () => {
	rowsByProject.app = [row("app-default", "app", "/repo/packages/app")];
	useAppStore.setState({
		projects: [project("repo", "/repo"), project("app", "/repo/packages/app"), project("x", "/x")],
		workspaces: { repo: [row("repo-default", "repo", "/repo")] },
	});
	const found = await resolveOpenWorkspaceForPath("/repo/packages/app/src/a.ts");
	expect(found?.id).toBe("app-default");
	expect(listed).toEqual(["app"]);
});

test("falls back to the remaining open projects for a worktree outside every project folder", async () => {
	rowsByProject.repo = [row("repo-default", "repo", "/repo"), row("wt", "repo", "/worktrees/wt")];
	rowsByProject.x = [row("x-default", "x", "/x")];
	useAppStore.setState({
		projects: [project("repo", "/repo"), project("x", "/x")],
		workspaces: {},
	});
	const found = await resolveOpenWorkspaceForPath("/worktrees/wt/src/a.ts");
	expect(found?.id).toBe("wt");
	expect(listed).toEqual(["repo", "x"]);
	expect(useAppStore.getState().workspaces.x).toEqual(rowsByProject.x);
});

test("never answers with a closed project's cached row or an unlisted outside path", async () => {
	rowsByProject.repo = [row("repo-default", "repo", "/repo")];
	useAppStore.setState({
		projects: [project("repo", "/repo"), project("down", "/down")],
		workspaces: { closed: [row("closed-default", "closed", "/closed")] },
	});
	expect(await resolveOpenWorkspaceForPath("/closed/a.ts")).toBeNull();
	expect(await resolveOpenWorkspaceForPath("/etc/passwd")).toBeNull();
	expect(useAppStore.getState().workspaces.down).toBeUndefined();
});

test("keeps a list that loaded while its request was in flight", async () => {
	const fresh = [row("repo-default", "repo", "/repo"), row("late", "repo", "/repo/late")];
	rowsByProject.repo = [row("repo-default", "repo", "/repo")];
	useAppStore.setState({ projects: [project("repo", "/repo")], workspaces: {} });
	const pending = resolveOpenWorkspaceForPath("/repo/late/a.ts");
	useAppStore.getState().setWorkspaces("repo", fresh);
	expect((await pending)?.id).toBe("late");
	expect(useAppStore.getState().workspaces.repo).toEqual(fresh);
});
