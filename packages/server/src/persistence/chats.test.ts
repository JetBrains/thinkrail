import { afterEach, beforeEach, expect, test } from "bun:test";
import {
	existsSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Project, Workspace } from "@thinkrail/contracts";
import {
	chatsStoreWritable,
	loadChats,
	loadProjects,
	loadWorkspaces,
	saveProjects,
	saveWorkspaces,
} from "./persistence";

let root: string;
const savedDataDir = process.env.THINKRAIL_DATA_DIR;

beforeEach(() => {
	root = realpathSync(mkdtempSync(join(tmpdir(), "trpi-chats-store-")));
	process.env.THINKRAIL_DATA_DIR = root;
});

afterEach(() => {
	rmSync(root, { recursive: true, force: true });
	if (savedDataDir === undefined) delete process.env.THINKRAIL_DATA_DIR;
	else process.env.THINKRAIL_DATA_DIR = savedDataDir;
});

const repo: Project = { id: "p", name: "repo", path: "/repos/one", slug: "repo", lastOpened: 1 };
const container: Project = {
	id: "c",
	name: "Chats",
	path: "/data/chats",
	slug: "chats",
	lastOpened: 2,
	kind: "chats",
	trusted: false,
};
const worktree: Workspace = {
	id: "w",
	projectId: "p",
	name: "feature",
	branch: "feature",
	worktreePath: "/repos/one-feature",
	baseBranch: "main",
};
const chat: Workspace = {
	id: "ch",
	projectId: "c",
	kind: "chat",
	name: "Chat",
	branch: "",
	worktreePath: "/data/chats/2026-10-26-ab12cd",
	baseBranch: "",
};

const legacy = (file: string) => JSON.parse(readFileSync(join(root, file), "utf8")) as unknown[];

test("saving partitions the Chats container and chat workspaces into chats.json, loading merges them back", () => {
	saveProjects([repo, container]);
	saveWorkspaces([worktree, chat]);

	expect(legacy("projects.json")).toEqual([repo]);
	expect(legacy("workspaces.json")).toEqual([worktree]);
	expect(loadChats()).toEqual({ version: 1, container, chats: [chat] });
	expect(loadProjects()).toEqual([repo, container]);
	expect(loadWorkspaces()).toEqual([worktree, chat]);

	saveWorkspaces([
		{ ...worktree, lastActiveAt: 5 },
		{ ...chat, lastActiveAt: 6 },
	]);
	saveProjects([{ ...repo, slug: "repo-2" }, container]);
	expect(legacy("workspaces.json")).toEqual([{ ...worktree, lastActiveAt: 5 }]);
	expect(legacy("projects.json")).toEqual([{ ...repo, slug: "repo-2" }]);
	expect(loadChats().chats).toEqual([{ ...chat, lastActiveAt: 6 }]);
	expect(loadChats().container).toEqual(container);
});

test("a repository-only save never creates chats.json, and dropping every chat empties the file", () => {
	saveProjects([repo]);
	saveWorkspaces([worktree]);
	expect(existsSync(join(root, "chats.json"))).toBe(false);

	saveProjects([repo, container]);
	saveWorkspaces([worktree, chat]);
	saveWorkspaces([worktree]);
	expect(loadChats()).toEqual({ version: 1, container, chats: [] });
	expect(loadWorkspaces()).toEqual([worktree]);
});

test("a corrupt chats.json is set aside, loads as empty and refuses chat writes until restart", () => {
	writeFileSync(join(root, "chats.json"), "{not json");
	expect(loadChats()).toEqual({ version: 1, container: null, chats: [] });
	expect(chatsStoreWritable()).toBe(false);
	expect(readdirSync(root).some((name) => name.startsWith("chats.json.corrupt-"))).toBe(true);

	saveProjects([repo, container]);
	saveWorkspaces([worktree, chat]);
	expect(existsSync(join(root, "chats.json"))).toBe(false);
	expect(legacy("projects.json")).toEqual([repo]);
	expect(legacy("workspaces.json")).toEqual([worktree]);
});
