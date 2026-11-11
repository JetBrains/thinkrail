import { afterEach, beforeEach, expect, test } from "bun:test";
import {
	chmodSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Project, Workspace } from "@thinkrail/contracts";
import { DEFAULT_CONFIG } from "@thinkrail/contracts";
import {
	loadConfig,
	loadHostEnvironment,
	loadProjects,
	loadTerminalSessions,
	loadWorkspaceCreations,
	loadWorkspaces,
	resetChatsStoreForTests,
	saveConfig,
	saveProjects,
	saveTerminalSessions,
	saveWorkspaceCreations,
	saveWorkspaces,
} from "./persistence";

let root: string;
const savedDataDir = process.env.THINKRAIL_DATA_DIR;

beforeEach(() => {
	root = realpathSync(mkdtempSync(join(tmpdir(), "trpi-registry-")));
	process.env.THINKRAIL_DATA_DIR = root;
});

afterEach(() => {
	resetChatsStoreForTests();
	rmSync(root, { recursive: true, force: true });
	if (savedDataDir === undefined) delete process.env.THINKRAIL_DATA_DIR;
	else process.env.THINKRAIL_DATA_DIR = savedDataDir;
});

function workspace(id: string): Workspace {
	return {
		id,
		projectId: "p",
		name: id,
		branch: id,
		worktreePath: join(root, id),
		baseBranch: "main",
	};
}

function project(id: string): Project {
	return { id, name: id, path: join(root, id), slug: id, lastOpened: 1 };
}

function chatsContainer(): Project {
	return { ...project("chats"), kind: "chats" };
}

function setAsideCopies(file: string): string[] {
	return readdirSync(root)
		.filter((name) => name.startsWith(`${file}.corrupt-`))
		.map((name) => readFileSync(join(root, name), "utf8"));
}

test("a torn workspaces.json is set aside, so the next save cannot destroy its records", () => {
	saveWorkspaces([workspace("a"), workspace("b"), workspace("c")]);
	const full = readFileSync(join(root, "workspaces.json"), "utf8");
	const torn = full.slice(0, Math.floor(full.length / 2));
	writeFileSync(join(root, "workspaces.json"), torn);

	expect(loadWorkspaces()).toEqual([]);
	saveWorkspaces([workspace("new")]);

	expect(setAsideCopies("workspaces.json")).toEqual([torn]);
	expect(loadWorkspaces().map((ws) => ws.id)).toEqual(["new"]);
});

test("empty or wrongly shaped registry files are set aside and load as their empty default", () => {
	writeFileSync(join(root, "projects.json"), "");
	writeFileSync(join(root, "workspaces.json"), "{}");
	writeFileSync(join(root, "workspace-creations.json"), "{}");
	writeFileSync(join(root, "terminals.json"), "[]");
	writeFileSync(join(root, "config.json"), "[]");
	writeFileSync(join(root, "environment.json"), "{ not json");

	expect(loadProjects()).toEqual([]);
	expect(loadWorkspaces()).toEqual([]);
	expect(loadWorkspaceCreations()).toEqual([]);
	expect(loadTerminalSessions()).toEqual({});
	expect(loadConfig()).toEqual(DEFAULT_CONFIG);
	expect(loadHostEnvironment()).toEqual({ vars: [] });

	expect(setAsideCopies("projects.json")).toEqual([""]);
	expect(setAsideCopies("workspaces.json")).toEqual(["{}"]);
	expect(setAsideCopies("workspace-creations.json")).toEqual(["{}"]);
	expect(setAsideCopies("terminals.json")).toEqual(["[]"]);
	expect(setAsideCopies("config.json")).toEqual(["[]"]);
	expect(setAsideCopies("environment.json")).toEqual(["{ not json"]);
});

test("missing registry files load as their empty default without leaving anything behind", () => {
	expect(loadProjects()).toEqual([]);
	expect(loadWorkspaces()).toEqual([]);
	expect(loadWorkspaceCreations()).toEqual([]);
	expect(loadTerminalSessions()).toEqual({});
	expect(loadConfig()).toEqual(DEFAULT_CONFIG);
	expect(readdirSync(root)).toEqual([]);
});

test("registry saves replace the file whole and leave no temp files", () => {
	saveProjects([project("a")]);
	saveWorkspaces([workspace("a")]);
	saveTerminalSessions({ a: [{ tabKey: "t", title: "zsh" }] });

	expect(loadProjects().map((p) => p.id)).toEqual(["a"]);
	expect(loadWorkspaces().map((ws) => ws.id)).toEqual(["a"]);
	expect(loadTerminalSessions()).toEqual({ a: [{ tabKey: "t", title: "zsh" }] });
	expect(readdirSync(root).sort()).toEqual(["projects.json", "terminals.json", "workspaces.json"]);
});

const posixOnly = process.platform === "win32" ? test.skip : test;

function permissions(file: string): number {
	return statSync(join(root, file)).mode & 0o777;
}

function withUmask(mask: number, run: () => void): void {
	const previous = process.umask(mask);
	try {
		run();
	} finally {
		process.umask(previous);
	}
}

const registrySaves: Array<[string, () => void]> = [
	["projects.json", () => saveProjects([project("a")])],
	["workspaces.json", () => saveWorkspaces([workspace("a")])],
	["chats.json", () => saveProjects([chatsContainer()])],
	[
		"workspace-creations.json",
		() =>
			saveWorkspaceCreations([
				{
					id: "a",
					projectId: "p",
					name: "a",
					branch: "a",
					baseBranch: "main",
					worktreePath: join(root, "a"),
					state: "running",
					phase: "preparing",
					startedAt: 1,
				},
			]),
	],
	[
		"terminals.json",
		() => saveTerminalSessions({ a: [{ tabKey: "t", title: "zsh", recorded: "out" }] }),
	],
	["config.json", () => saveConfig(DEFAULT_CONFIG)],
];

posixOnly("a save under a looser umask keeps a private registry file private", () => {
	for (const [file, save] of registrySaves) {
		withUmask(0o077, save);
		expect(permissions(file)).toBe(0o600);
		withUmask(0o022, save);
		expect(permissions(file)).toBe(0o600);
	}
});

posixOnly("a save keeps the exact permissions the user gave an existing file", () => {
	for (const [file, save] of registrySaves) {
		save();
		chmodSync(join(root, file), 0o640);
		withUmask(0o077, save);
		expect(permissions(file)).toBe(0o640);
	}
});

posixOnly("a new registry file is created owner-only whatever the umask", () => {
	for (const [file, save] of registrySaves) {
		withUmask(0o022, save);
		expect(permissions(file)).toBe(0o600);
	}
});
