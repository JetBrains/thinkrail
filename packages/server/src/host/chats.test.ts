import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { createFauxCore, fauxAssistantMessage } from "@earendil-works/pi-ai/providers/faux";
import { ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent";
import type { ChatCreateResult, Project, Workspace } from "@thinkrail/contracts";
import { CHATS_PROTOCOL_VERSION } from "@thinkrail/contracts";
import {
	configurePiRuntime,
	disposeAllSessions,
	initializeSessionStates,
	promptSession,
	setSessionManagerFactory,
	settleSessionsForShutdown,
} from "../agent";
import { loadChats } from "../persistence";
import { openProject } from "../projects";
import { resetConfigCache } from "../settings";
import { setTrashImplementationForTests } from "../trash";
import { stopAllWatches } from "../watch";
import { chatsRoot, ensureChatsContainer, resetChatIdCache } from "../workspaces";
import { applyGitCeiling } from "./gitCeiling";
import { handleRequest } from "./handlers";

const CTX = { clientKey: "chats-test" };
const OLD_CLIENT = { clientKey: "old-client", protocolVersion: CHATS_PROTOCOL_VERSION - 1 };

const model = {
	id: "chats-model",
	name: "chats-model",
	reasoning: false,
	input: ["text"] as ("text" | "image")[],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 100_000,
	maxTokens: 4096,
};
const faux = createFauxCore({
	provider: "chats",
	api: "chats",
	models: [model],
	tokensPerSecond: 10000,
});
const saved = {
	agent: process.env.PI_CODING_AGENT_DIR,
	data: process.env.THINKRAIL_DATA_DIR,
	offline: process.env.PI_OFFLINE,
	ceiling: process.env.GIT_CEILING_DIRECTORIES,
};
const root = realpathSync.native(mkdtempSync(join(tmpdir(), "trpi-chats-host-")));
const trashed: string[] = [];
const gitSpawns: { argv: string[]; cwd: string | undefined }[] = [];
const realSpawn = Bun.spawn;
const realSpawnSync = Bun.spawnSync;

function git(cwd: string, ...args: string[]): { ok: boolean; out: string } {
	const result = realSpawnSync(["git", "-C", cwd, ...args], {
		stdout: "pipe",
		stderr: "pipe",
		env: { ...process.env },
	});
	return { ok: result.success, out: new TextDecoder().decode(result.stdout).trim() };
}

function gitRepo(path: string): string {
	mkdirSync(path, { recursive: true });
	for (const args of [
		["init", "-b", "main"],
		["config", "user.email", "t@thinkrail.test"],
		["config", "user.name", "test"],
		["config", "commit.gpgsign", "false"],
	]) {
		if (!git(path, ...args).ok) throw new Error(`git ${args.join(" ")} failed`);
	}
	writeFileSync(join(path, "README.md"), "# repo\n");
	git(path, "add", "-A");
	git(path, "commit", "-m", "init");
	return path;
}

function recordGitSpawns(): void {
	const record = (argv: unknown, options: unknown) => {
		const command = Array.isArray(argv) ? argv.map(String) : [];
		if (command[0] === "git") {
			const cwd = (options as { cwd?: string } | undefined)?.cwd;
			gitSpawns.push({ argv: command, cwd });
		}
	};
	(Bun as { spawn: typeof Bun.spawn }).spawn = ((argv: unknown, options?: unknown) => {
		record(argv, options);
		return (realSpawn as (a: unknown, o?: unknown) => ReturnType<typeof Bun.spawn>)(argv, options);
	}) as typeof Bun.spawn;
	(Bun as { spawnSync: typeof Bun.spawnSync }).spawnSync = ((argv: unknown, options?: unknown) => {
		record(argv, options);
		return (realSpawnSync as (a: unknown, o?: unknown) => ReturnType<typeof Bun.spawnSync>)(
			argv,
			options,
		);
	}) as typeof Bun.spawnSync;
}

const dataDir = join(root, "enclosing-repo", "data");

beforeAll(async () => {
	gitRepo(join(root, "enclosing-repo"));
	mkdirSync(dataDir, { recursive: true });
	process.env.PI_CODING_AGENT_DIR = join(root, "agent");
	process.env.THINKRAIL_DATA_DIR = dataDir;
	process.env.PI_OFFLINE = "1";
	delete process.env.GIT_CEILING_DIRECTORIES;
	resetConfigCache();
	resetChatIdCache();
	const runtime = await ModelRuntime.create({
		credentials: new InMemoryCredentialStore(),
		modelsPath: null,
		allowModelNetwork: false,
	});
	runtime.registerProvider("chats", {
		api: faux.api,
		apiKey: "test",
		baseUrl: "http://faux.local",
		streamSimple: faux.streamSimple,
		models: [{ ...model, api: faux.api }],
	});
	configurePiRuntime(runtime);
	setSessionManagerFactory((cwd) => SessionManager.create(cwd));
	await initializeSessionStates([]);
	setTrashImplementationForTests(async (input) => {
		for (const path of typeof input === "string" ? [input] : input) {
			trashed.push(path);
			rmSync(path, { recursive: true, force: true });
		}
	});
	recordGitSpawns();
});

beforeEach(() => {
	gitSpawns.length = 0;
});

afterAll(async () => {
	(Bun as { spawn: typeof Bun.spawn }).spawn = realSpawn;
	(Bun as { spawnSync: typeof Bun.spawnSync }).spawnSync = realSpawnSync;
	setTrashImplementationForTests(undefined);
	stopAllWatches();
	await settleSessionsForShutdown();
	disposeAllSessions();
	configurePiRuntime(null);
	resetChatIdCache();
	for (const [key, value] of [
		["PI_CODING_AGENT_DIR", saved.agent],
		["THINKRAIL_DATA_DIR", saved.data],
		["PI_OFFLINE", saved.offline],
		["GIT_CEILING_DIRECTORIES", saved.ceiling],
	] as const) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
	rmSync(root, { recursive: true, force: true });
});

function gitUnderChats(): typeof gitSpawns {
	return gitSpawns.filter(
		(spawn) =>
			spawn.cwd?.startsWith(chatsRoot()) || spawn.argv.some((arg) => arg.startsWith(chatsRoot())),
	);
}

test("the container is found or created by kind, and the ceiling keeps git from walking out of a chat folder", () => {
	applyGitCeiling();
	const container = ensureChatsContainer();
	expect(container).toMatchObject({ kind: "chats", path: chatsRoot(), trusted: false });
	expect(ensureChatsContainer().id).toBe(container.id);
	expect(loadChats().container?.id).toBe(container.id);
	expect(existsSync(chatsRoot())).toBe(true);

	const nested = join(chatsRoot(), "probe");
	mkdirSync(nested, { recursive: true });
	expect(git(join(root, "enclosing-repo"), "rev-parse", "--show-toplevel").ok).toBe(true);
	expect(git(nested, "rev-parse", "--show-toplevel").ok).toBe(false);
	rmSync(nested, { recursive: true, force: true });
});

test("a chat is created with its folder, record and one session, listed without git, and refused every repository door", async () => {
	const created = (await handleRequest("chat.create", {}, CTX)) as ChatCreateResult;
	const { workspace } = created;
	expect(workspace).toMatchObject({ kind: "chat", name: "Chat", branch: "", baseBranch: "" });
	expect(workspace.worktreePath.startsWith(chatsRoot())).toBe(true);
	expect(/\/\d{4}-\d{2}-\d{2}-[0-9a-f]{6}$/.test(workspace.worktreePath)).toBe(true);
	expect(existsSync(workspace.worktreePath)).toBe(true);
	expect(created.sessionId).toBeTruthy();
	expect(loadChats().chats.map((chat) => chat.id)).toEqual([workspace.id]);
	expect(JSON.parse(readFileSync(join(dataDir, "workspaces.json"), "utf8")) as Workspace[]).toEqual(
		[],
	);

	const rows = (await handleRequest(
		"workspace.list",
		{ projectId: workspace.projectId },
		CTX,
	)) as Workspace[];
	expect(rows.map((row) => row.id)).toEqual([workspace.id]);
	expect(rows[0]?.diffStats).toBeUndefined();

	await expect(handleRequest("session.create", { workspaceId: workspace.id }, CTX)).rejects.toThrow(
		"holds one conversation",
	);
	await expect(handleRequest("workspace.remove", { id: workspace.id }, CTX)).rejects.toThrow(
		"cannot be removed here",
	);
	await expect(
		handleRequest("workspace.rename", { id: workspace.id, name: "Named" }, CTX),
	).rejects.toThrow("cannot be renamed");
	await expect(handleRequest("workspace.settle", { id: workspace.id }, CTX)).rejects.toThrow(
		"cannot be settled",
	);
	await expect(
		handleRequest("workspace.setDiffBase", { id: workspace.id, ref: "main" }, CTX),
	).rejects.toThrow("asked about git");
	await expect(handleRequest("git.status", { workspaceId: workspace.id }, CTX)).rejects.toThrow(
		"asked about git",
	);
	await expect(
		handleRequest("workspace.branchStatus", { workspaceId: workspace.id }, CTX),
	).rejects.toThrow("branch status");
	await expect(
		handleRequest(
			"session.delete",
			{ workspaceId: workspace.id, sessionId: created.sessionId },
			CTX,
		),
	).rejects.toThrow("delete the chat");
	for (const [method, params] of [
		["project.close", { id: workspace.projectId }],
		["project.rename", { id: workspace.projectId, name: "Mine" }],
		["project.setTrust", { id: workspace.projectId, trusted: true }],
		["workspace.create", { projectId: workspace.projectId }],
		["workspace.listExisting", { projectId: workspace.projectId }],
		["git.listBranches", { projectId: workspace.projectId }],
	] as const) {
		await expect(handleRequest(method, params, CTX)).rejects.toThrow("not a repository");
	}
	await expect(
		handleRequest("project.open", { path: workspace.worktreePath }, CTX),
	).rejects.toThrow("cannot be opened as a project");
	await expect(
		handleRequest("project.init", { path: workspace.worktreePath }, CTX),
	).rejects.toThrow("cannot be opened as a project");
	await expect(
		handleRequest("project.create", { parentPath: workspace.worktreePath, name: "nested" }, CTX),
	).rejects.toThrow("cannot be opened as a project");
	expect(existsSync(join(workspace.worktreePath, "nested"))).toBe(false);
	expect(gitUnderChats()).toEqual([]);

	faux.setResponses([fauxAssistantMessage("noted")]);
	await promptSession(created.sessionId, "remember this");
	await handleRequest("chat.delete", { workspaceId: workspace.id }, CTX);
	expect(existsSync(workspace.worktreePath)).toBe(false);
	expect(trashed.some((path) => path === workspace.worktreePath)).toBe(true);
	expect(trashed.some((path) => path.endsWith(`_${created.sessionId}.jsonl`))).toBe(true);
	expect(loadChats().chats).toEqual([]);
	expect(gitUnderChats()).toEqual([]);
}, 30_000);

test("an older client never sees the container, its chats or their session states", async () => {
	const created = (await handleRequest("chat.create", {}, CTX)) as ChatCreateResult;
	faux.setResponses([fauxAssistantMessage("hello")]);
	await promptSession(created.sessionId, "say hello");
	try {
		const newProjects = (await handleRequest("project.list", {}, CTX)) as Project[];
		const oldProjects = (await handleRequest("project.list", {}, OLD_CLIENT)) as Project[];
		expect(newProjects.some((project) => project.kind === "chats")).toBe(true);
		expect(oldProjects.some((project) => project.kind === "chats")).toBe(false);

		const newStates = (await handleRequest("session.stateList", {}, CTX)) as {
			workspaceId: string;
			title?: string;
		}[];
		const oldStates = (await handleRequest("session.stateList", {}, OLD_CLIENT)) as {
			workspaceId: string;
		}[];
		expect(newStates.some((record) => record.workspaceId === created.workspace.id)).toBe(true);
		expect(oldStates.some((record) => record.workspaceId === created.workspace.id)).toBe(false);
	} finally {
		await handleRequest("chat.delete", { workspaceId: created.workspace.id }, CTX);
	}
}, 30_000);

test("a chat whose session never started gets one through session.create, and a repository stays a repository", async () => {
	const repo = gitRepo(join(root, "repo"));
	const project = openProject(repo);
	const rows = (await handleRequest(
		"workspace.list",
		{ projectId: project.id },
		CTX,
	)) as Workspace[];
	expect(rows[0]?.kind).toBe("default");

	const created = (await handleRequest("chat.create", {}, CTX)) as ChatCreateResult;
	await handleRequest("session.delete", { workspaceId: rows[0]?.id, sessionId: "none" }, CTX).catch(
		() => {},
	);
	const inspected = (await handleRequest(
		"chat.inspect",
		{ workspaceId: created.workspace.id },
		CTX,
	)) as { files: number; truncated: boolean };
	expect(inspected.truncated).toBe(false);
	writeFileSync(join(created.workspace.worktreePath, "notes.md"), "notes\n");
	expect(
		(
			(await handleRequest("chat.inspect", { workspaceId: created.workspace.id }, CTX)) as {
				files: number;
			}
		).files,
	).toBe(inspected.files + 1);
	await handleRequest("chat.delete", { workspaceId: created.workspace.id }, CTX);
}, 30_000);
