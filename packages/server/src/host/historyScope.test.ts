import { expect, test } from "bun:test";
import type { Project, Workspace } from "@thinkrail/contracts";
import { buildHistoryScope } from "./historyScope";

test("all scope: filter matches any cwd + sessionId", () => {
	const { filter } = buildHistoryScope({ kind: "all" }, [], () => []);

	expect(filter("/some/cwd", "session1")).toBe(true);
	expect(filter("/another/cwd", "session2")).toBe(true);
	expect(filter("", "")).toBe(true);
});

test("chat scope: filter matches only the exact sessionId", () => {
	const { filter } = buildHistoryScope({ kind: "chat", sessionId: "target-session" }, [], () => []);

	expect(filter("/some/cwd", "target-session")).toBe(true);
	expect(filter("/some/cwd", "other-session")).toBe(false);
	expect(filter("/another/cwd", "target-session")).toBe(true);
});

test("workspace scope: filter matches the worktreePath of a known workspace", () => {
	const p1: Project = {
		id: "p1",
		name: "project",
		path: "/proj",
		slug: "project",
		lastOpened: 0,
	};
	const ws1: Workspace = {
		id: "ws1",
		projectId: "p1",
		name: "ws1",
		branch: "ws1",
		worktreePath: "/proj/worktrees/ws1",
		baseBranch: "main",
	};
	const ws2: Workspace = {
		id: "ws2",
		projectId: "p1",
		name: "ws2",
		branch: "ws2",
		worktreePath: "/proj/worktrees/ws2",
		baseBranch: "main",
	};

	const { filter } = buildHistoryScope(
		{ kind: "workspace", workspaceId: "ws1" },
		[p1],
		(projectId) => (projectId === "p1" ? [ws1, ws2] : []),
	);

	expect(filter("/proj/worktrees/ws1", "any-session")).toBe(true);
	expect(filter("/proj/worktrees/ws2", "any-session")).toBe(false);
	expect(filter("/other/path", "any-session")).toBe(false);
});

test("workspace scope with unknown workspaceId: filter always returns false, even with other workspaces in registry", () => {
	const p1: Project = {
		id: "p1",
		name: "project",
		path: "/proj",
		slug: "project",
		lastOpened: 0,
	};
	const ws1: Workspace = {
		id: "ws1",
		projectId: "p1",
		name: "ws1",
		branch: "ws1",
		worktreePath: "/proj/worktrees/ws1",
		baseBranch: "main",
	};
	const ws2: Workspace = {
		id: "ws2",
		projectId: "p1",
		name: "ws2",
		branch: "ws2",
		worktreePath: "/proj/worktrees/ws2",
		baseBranch: "main",
	};

	const { filter } = buildHistoryScope(
		{ kind: "workspace", workspaceId: "unknown-ws" },
		[p1],
		(projectId) => (projectId === "p1" ? [ws1, ws2] : []),
	);

	expect(filter("/proj/worktrees/ws1", "any-session")).toBe(false);
	expect(filter("/proj/worktrees/ws2", "any-session")).toBe(false);
	expect(filter("/", "session1")).toBe(false);
	expect(filter("", "")).toBe(false);
});

test("project scope: filter matches cwds of any workspace in the project", () => {
	const ws1: Workspace = {
		id: "ws1",
		projectId: "p1",
		name: "ws1",
		branch: "ws1",
		worktreePath: "/proj/worktrees/ws1",
		baseBranch: "main",
	};
	const ws2: Workspace = {
		id: "ws2",
		projectId: "p1",
		name: "ws2",
		branch: "ws2",
		worktreePath: "/proj/worktrees/ws2",
		baseBranch: "main",
	};

	const { filter } = buildHistoryScope(
		{ kind: "project", projectId: "p1" },
		[{ id: "p1", name: "project", path: "/proj", slug: "project", lastOpened: 0 }],
		(projectId) => (projectId === "p1" ? [ws1, ws2] : []),
	);

	expect(filter("/proj/worktrees/ws1", "any-session")).toBe(true);
	expect(filter("/proj/worktrees/ws2", "any-session")).toBe(true);
	expect(filter("/other/project/worktrees/ws1", "any-session")).toBe(false);
});

test("labels: build a worktreePath → {workspaceId, projectId} map from all projects' workspaces", () => {
	const p1: Project = {
		id: "p1",
		name: "project-1",
		path: "/proj1",
		slug: "project-1",
		lastOpened: 0,
	};
	const p2: Project = {
		id: "p2",
		name: "project-2",
		path: "/proj2",
		slug: "project-2",
		lastOpened: 0,
	};

	const p1ws1: Workspace = {
		id: "p1ws1",
		projectId: "p1",
		name: "ws1",
		branch: "ws1",
		worktreePath: "/proj1/worktrees/ws1",
		baseBranch: "main",
	};
	const p1ws2: Workspace = {
		id: "p1ws2",
		projectId: "p1",
		name: "ws2",
		branch: "ws2",
		worktreePath: "/proj1/worktrees/ws2",
		baseBranch: "main",
	};
	const p2ws1: Workspace = {
		id: "p2ws1",
		projectId: "p2",
		name: "ws1",
		branch: "ws1",
		worktreePath: "/proj2/worktrees/ws1",
		baseBranch: "main",
	};

	const { labels } = buildHistoryScope({ kind: "all" }, [p1, p2], (projectId) => {
		if (projectId === "p1") return [p1ws1, p1ws2];
		if (projectId === "p2") return [p2ws1];
		return [];
	});

	expect(labels("/proj1/worktrees/ws1")).toEqual({
		workspaceId: "p1ws1",
		projectId: "p1",
	});
	expect(labels("/proj1/worktrees/ws2")).toEqual({
		workspaceId: "p1ws2",
		projectId: "p1",
	});
	expect(labels("/proj2/worktrees/ws1")).toEqual({
		workspaceId: "p2ws1",
		projectId: "p2",
	});
	expect(labels("/unknown/path")).toEqual({});
});

test("unknown scope kind: filter always returns false, never throws", () => {
	const { filter } = buildHistoryScope({ kind: "bogus" } as never, [], () => []);

	expect(filter("/some/cwd", "session1")).toBe(false);
	expect(filter("/another/cwd", "session2")).toBe(false);
});

test("a cwd the client may not learn of is out of every scope, whatever the scope names", () => {
	const repo: Project = { id: "p1", name: "repo", path: "/repo", slug: "repo", lastOpened: 0 };
	const container: Project = {
		id: "c",
		name: "Chats",
		path: "/data/chats",
		slug: "chats",
		lastOpened: 0,
		kind: "chats",
	};
	const repoDefault: Workspace = {
		id: "w-repo",
		projectId: "p1",
		kind: "default",
		name: "Default",
		branch: "main",
		worktreePath: "/repo",
		baseBranch: "main",
	};
	const chat: Workspace = {
		id: "w-chat",
		projectId: "c",
		kind: "chat",
		name: "Chat",
		branch: "",
		worktreePath: "/data/chats/2026-10-26-ab12cd",
		baseBranch: "",
	};
	const records = (projectId: string) =>
		[repoDefault, chat].filter((workspace) => workspace.projectId === projectId);
	const hidden = (cwd: string) => cwd.startsWith("/data/chats/");
	for (const scope of [
		{ kind: "all" },
		{ kind: "chat", sessionId: "s-chat" },
		{ kind: "workspace", workspaceId: "w-chat" },
		{ kind: "project", projectId: "c" },
	] as const) {
		const visible = buildHistoryScope(scope, [repo, container], records);
		const older = buildHistoryScope(scope, [repo, container], records, hidden);
		expect(visible.filter(chat.worktreePath, "s-chat")).toBe(true);
		expect(older.filter(chat.worktreePath, "s-chat")).toBe(false);
		expect(older.filter("/data/chats/2026-10-25-orphan", "s-chat")).toBe(false);
	}
	const older = buildHistoryScope({ kind: "all" }, [repo, container], records, hidden);
	expect(older.filter("/repo", "s-repo")).toBe(true);
	expect(older.filter("/somewhere/else", "s-cli")).toBe(true);
});
