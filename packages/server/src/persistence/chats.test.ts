import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import {
	existsSync,
	mkdirSync,
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
	chatsStoreProblem,
	loadChats,
	loadProjects,
	loadWorkspaces,
	resetChatsStoreForTests,
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
	resetChatsStoreForTests();
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

const setAside = () => readdirSync(root).filter((name) => name.startsWith("chats.json.corrupt-"));

for (const [label, contents] of [
	["not JSON", "{not json"],
	[
		"a version-1 store of the wrong shape",
		JSON.stringify({ version: 1, container: { kind: "chats" }, chats: [] }),
	],
	[
		"a version-1 store whose chat names another container",
		JSON.stringify({ version: 1, container, chats: [{ ...chat, projectId: "elsewhere" }] }),
	],
] as const) {
	test(`${label} is set aside, loads as empty and refuses chat writes until restart`, () => {
		writeFileSync(join(root, "chats.json"), contents);
		expect(loadChats()).toEqual({ version: 1, container: null, chats: [] });
		expect(chatsStoreProblem()).toBe("set-aside");
		expect(setAside()).toHaveLength(1);

		saveProjects([repo, container]);
		saveWorkspaces([worktree, chat]);
		expect(existsSync(join(root, "chats.json"))).toBe(false);
		expect(legacy("projects.json")).toEqual([repo]);
		expect(legacy("workspaces.json")).toEqual([worktree]);
		expect(chatsStoreProblem()).toBe("set-aside");
	});
}

test("a store a newer host wrote is left untouched: it loads as empty and refuses chat writes", () => {
	const newer = `${JSON.stringify({ version: 2, chats: [{ kind: "chat", shape: "future" }] })}\n`;
	writeFileSync(join(root, "chats.json"), newer);
	expect(loadChats()).toEqual({ version: 1, container: null, chats: [] });
	expect(chatsStoreProblem()).toBe("newer");

	saveProjects([repo, container]);
	saveWorkspaces([worktree, chat]);
	expect(readFileSync(join(root, "chats.json"), "utf8")).toBe(newer);
	expect(setAside()).toEqual([]);
	expect(legacy("workspaces.json")).toEqual([worktree]);
});

test("a store that cannot be read right now is reported unavailable, never renamed, and read again next time", () => {
	saveProjects([repo, container]);
	saveWorkspaces([worktree, chat]);
	const stored = readFileSync(join(root, "chats.json"), "utf8");
	rmSync(join(root, "chats.json"));
	mkdirSync(join(root, "chats.json"));
	expect(loadChats()).toEqual({ version: 1, container: null, chats: [] });
	expect(chatsStoreProblem()).toBe("unreadable");
	saveWorkspaces([worktree]);
	expect(setAside()).toEqual([]);

	rmSync(join(root, "chats.json"), { recursive: true });
	writeFileSync(join(root, "chats.json"), stored);
	expect(chatsStoreProblem()).toBeNull();
	expect(loadChats()).toEqual({ version: 1, container, chats: [chat] });
});

test("the parsed store is cached until the file changes, and a caller's edits never reach the cache", () => {
	saveProjects([repo, container]);
	saveWorkspaces([worktree, chat]);
	const parse = spyOn(JSON, "parse");
	try {
		const loaded = loadChats();
		const first = parse.mock.calls.length;
		(loaded.chats[0] as Workspace).name = "edited in memory";
		expect(loadChats().chats[0]?.name).toBe("Chat");
		expect(parse.mock.calls.length).toBe(first);

		writeFileSync(
			join(root, "chats.json"),
			JSON.stringify({ version: 1, container, chats: [{ ...chat, name: "edited on disk" }] }),
		);
		expect(loadChats().chats[0]?.name).toBe("edited on disk");
	} finally {
		parse.mockRestore();
	}
});
