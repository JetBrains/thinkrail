import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import {
	type Project,
	WORKSPACE_PATH_RESOLVE_PROTOCOL_VERSION,
	type Workspace,
	type WorkspacePathMatch,
} from "@thinkrail/contracts";

const listed: string[] = [];
const resolved: string[] = [];
const rowsByProject: Record<string, Workspace[]> = {};
let hostMatch: WorkspacePathMatch | null = null;
const actualTransport = await import("../transport");
mock.module("../transport", () => ({
	...actualTransport,
	getTransport: () => ({
		request: (method: string, params: { projectId?: string; path?: string }) => {
			if (method === "workspace.resolvePath" && params.path) {
				resolved.push(params.path);
				return Promise.resolve(hostMatch);
			}
			if (method !== "workspace.list" || !params.projectId)
				return Promise.reject(new Error(method));
			listed.push(params.projectId);
			const rows = rowsByProject[params.projectId];
			return rows ? Promise.resolve(rows) : Promise.reject(new Error("unreachable"));
		},
	}),
}));

const { useAppStore } = await import("../store");
const { resolveWorkspaceFile } = await import("./workspaceForPath");
const initial = useAppStore.getInitialState();

const project = (id: string, path: string): Project => ({
	id,
	name: id,
	path,
	slug: id,
	lastOpened: 0,
});
const row = (
	id: string,
	projectId: string,
	worktreePath: string,
	extra: Partial<Workspace> = {},
): Workspace => ({
	id,
	projectId,
	name: id,
	branch: id,
	baseBranch: "main",
	worktreePath,
	...extra,
});
const ownerId = async (path: string) => (await resolveWorkspaceFile(path))?.workspaceId ?? null;

beforeEach(() => {
	listed.length = 0;
	resolved.length = 0;
	hostMatch = null;
	for (const key of Object.keys(rowsByProject)) delete rowsByProject[key];
	useAppStore.setState(initial, true);
	useAppStore.setState({ protocolVersion: WORKSPACE_PATH_RESOLVE_PROTOCOL_VERSION });
});
afterAll(() => useAppStore.setState(initial, true));

test("a host that resolves paths answers from its real-path match without any client listing", async () => {
	hostMatch = { workspaceId: "wt", projectId: "repo", relativePath: "src/a.ts" };
	useAppStore.setState({ projects: [project("repo", "/tmp/repo")], workspaces: {} });
	expect(await resolveWorkspaceFile("/private/tmp/repo/src/a.ts")).toEqual(hostMatch);
	expect(resolved).toEqual(["/private/tmp/repo/src/a.ts"]);
	expect(listed).toEqual([]);
});

describe("an older host: the loaded roots' spelling", () => {
	beforeEach(() => {
		useAppStore.setState({ protocolVersion: WORKSPACE_PATH_RESOLVE_PROTOCOL_VERSION - 1 });
	});

	test("lists an enclosing nested project before trusting an already loaded parent", async () => {
		rowsByProject.app = [row("app-default", "app", "/repo/packages/app")];
		useAppStore.setState({
			projects: [
				project("repo", "/repo"),
				project("app", "/repo/packages/app"),
				project("x", "/x"),
			],
			workspaces: { repo: [row("repo-default", "repo", "/repo")] },
		});
		expect(await resolveWorkspaceFile("/repo/packages/app/src/a.ts")).toEqual({
			workspaceId: "app-default",
			projectId: "app",
			relativePath: "src/a.ts",
		});
		expect(listed).toEqual(["app"]);
		expect(resolved).toEqual([]);
	});

	test("falls back to the remaining open projects for a worktree outside every project folder", async () => {
		rowsByProject.repo = [row("repo-default", "repo", "/repo"), row("wt", "repo", "/worktrees/wt")];
		rowsByProject.x = [row("x-default", "x", "/x")];
		useAppStore.setState({
			projects: [project("repo", "/repo"), project("x", "/x")],
			workspaces: {},
		});
		expect(await ownerId("/worktrees/wt/src/a.ts")).toBe("wt");
		expect(listed).toEqual(["repo", "x"]);
		expect(useAppStore.getState().workspaces.x).toEqual(rowsByProject.x);
	});

	test("never answers with a closed project's cached row or an unlisted outside path", async () => {
		rowsByProject.repo = [row("repo-default", "repo", "/repo")];
		useAppStore.setState({
			projects: [project("repo", "/repo"), project("down", "/down")],
			workspaces: { closed: [row("closed-default", "closed", "/closed")] },
		});
		expect(await resolveWorkspaceFile("/closed/a.ts")).toBeNull();
		expect(await resolveWorkspaceFile("/etc/passwd")).toBeNull();
		expect(useAppStore.getState().workspaces.down).toBeUndefined();
	});

	test("keeps a list that loaded while its request was in flight", async () => {
		const fresh = [row("repo-default", "repo", "/repo"), row("late", "repo", "/repo/late")];
		rowsByProject.repo = [row("repo-default", "repo", "/repo")];
		useAppStore.setState({ projects: [project("repo", "/repo")], workspaces: {} });
		const pending = ownerId("/repo/late/a.ts");
		useAppStore.getState().setWorkspaces("repo", fresh);
		expect(await pending).toBe("late");
		expect(useAppStore.getState().workspaces.repo).toEqual(fresh);
	});

	test("picks the most specific root, resolves dot segments and skips what cannot be entered", async () => {
		useAppStore.setState({
			projects: [project("p1", "/one"), project("p2", "/two")],
			workspaces: {
				p1: [row("one", "p1", "/one"), row("nested", "p1", "/one/packages/app")],
				p2: [
					row("two", "p2", "/two"),
					row("doomed", "p2", "/two/doomed", { deletionPending: true }),
				],
			},
		});
		expect(await ownerId("/one/packages/app/src/a.ts")).toBe("nested");
		expect(await ownerId("/one-other/a.ts")).toBeNull();
		expect(await ownerId("/one/packages/../src/a.ts")).toBe("one");
		expect(await ownerId("/one/../two/a.ts")).toBe("two");
		expect(await ownerId("/two/doomed/a.ts")).toBe("two");
		expect(await ownerId("/one")).toBeNull();
		useAppStore.setState({ removedWorkspaceIds: { nested: true } });
		expect(await ownerId("/one/packages/app/a.ts")).toBe("one");
	});

	test("prefers the active workspace between equal roots", async () => {
		useAppStore.setState({
			projects: [project("p1", "/one")],
			workspaces: { p1: [row("a", "p1", "/one"), row("b", "p1", "/one/")] },
		});
		expect(await ownerId("/one/a.ts")).toBe("a");
		useAppStore.setState({ activeWorkspaceId: "b" });
		expect(await ownerId("/one/a.ts")).toBe("b");
	});
});
