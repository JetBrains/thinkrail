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
import { AgentSession, ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent";
import type { ChatCreateResult, Project, Workspace, WsResult } from "@thinkrail/contracts";
import { CHATS_PROTOCOL_VERSION } from "@thinkrail/contracts";
import {
	configurePiRuntime,
	disposeAllSessions,
	hasSession,
	initializeSessionStates,
	listSessions,
	promptSession,
	setSessionManagerFactory,
	settleSessionsForShutdown,
} from "../agent";
import { loadChats, resetChatsStoreForTests } from "../persistence";
import { openProject } from "../projects";
import { getConfig, resetConfigCache } from "../settings";
import { setTrashImplementationForTests } from "../trash";
import { stopAllWatches } from "../watch";
import {
	chatsRoot,
	createChatRecord,
	ensureChatsContainer,
	getChatWorkspace,
	resetChatIdCache,
} from "../workspaces";
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
const thinker = { ...model, id: "chats-thinker", name: "chats-thinker", reasoning: true };
const faux = createFauxCore({
	provider: "chats",
	api: "chats",
	models: [model, thinker],
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
const recordTrash = async (input: string | readonly string[]) => {
	for (const path of typeof input === "string" ? [input] : input) {
		trashed.push(path);
		rmSync(path, { recursive: true, force: true });
	}
};
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
		models: [
			{ ...model, api: faux.api },
			{ ...thinker, api: faux.api },
		],
	});
	configurePiRuntime(runtime);
	setSessionManagerFactory((cwd) => SessionManager.create(cwd));
	await initializeSessionStates([]);
	setTrashImplementationForTests(recordTrash);
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

function deferred(): { promise: Promise<void>; resolve(): void } {
	let resolve = () => {};
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

/** Holds every session preparation inside pi's extension binding until released: a first session still starting. */
function holdSessionPreparations(): {
	entered: Promise<void>;
	release(): void;
	sessionIds: string[];
	restore(): void;
} {
	const original = AgentSession.prototype.bindExtensions;
	const entered = deferred();
	const release = deferred();
	const sessionIds: string[] = [];
	AgentSession.prototype.bindExtensions = async function (bindings) {
		await original.call(this, bindings);
		sessionIds.push(this.sessionId);
		entered.resolve();
		await release.promise;
	};
	return {
		entered: entered.promise,
		release: release.resolve,
		sessionIds,
		restore: () => {
			release.resolve();
			AgentSession.prototype.bindExtensions = original;
		},
	};
}

function newChatId(known: ReadonlySet<string>): string {
	const chat = loadChats().chats.find((candidate) => !known.has(candidate.id));
	if (!chat) throw new Error("no new chat record");
	return chat.id;
}

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

test("a chat whose session never started gets exactly one through session.create, while a repository takes many", async () => {
	const repo = gitRepo(join(root, "repo"));
	const project = openProject(repo);
	const rows = (await handleRequest(
		"workspace.list",
		{ projectId: project.id },
		CTX,
	)) as Workspace[];
	const defaultId = rows[0]?.id ?? "";
	expect(rows[0]?.kind).toBe("default");
	const first = (await handleRequest(
		"session.create",
		{ workspaceId: defaultId },
		CTX,
	)) as WsResult<"session.create">;
	const second = (await handleRequest(
		"session.create",
		{ workspaceId: defaultId },
		CTX,
	)) as WsResult<"session.create">;
	expect(second.sessionId).not.toBe(first.sessionId);

	const workspace = createChatRecord();
	expect(await listSessions(workspace.id, workspace.worktreePath)).toEqual([]);
	const recovered = (await handleRequest(
		"session.create",
		{ workspaceId: workspace.id },
		CTX,
	)) as WsResult<"session.create">;
	expect(recovered.model).toMatchObject({ provider: "chats", id: "chats-model" });
	expect(
		(await listSessions(workspace.id, workspace.worktreePath)).map((summary) => summary.sessionId),
	).toEqual([recovered.sessionId]);
	await expect(
		handleRequest("session.create", { workspaceId: workspace.id }, CTX),
	).rejects.toMatchObject({ code: "CHAT_HAS_SESSION" });
	await handleRequest("chat.delete", { workspaceId: workspace.id }, CTX);
}, 30_000);

test("an explicit model and effort reach a chat's session on creation and on recovery, and become recent", async () => {
	const models = (await handleRequest("model.list", {}, CTX)) as WsResult<"model.list">;
	const picked = models.find((candidate) => candidate.id === "chats-thinker");
	if (!picked) throw new Error("the reasoning fixture model is not listed");
	const created = (await handleRequest(
		"chat.create",
		{ model: picked, thinkingLevel: "high" },
		CTX,
	)) as ChatCreateResult;
	expect(created.model).toMatchObject({ provider: "chats", id: "chats-thinker" });
	expect(created.thinkingLevel).toBe("high");
	expect(getConfig().recentModels[0]).toMatchObject({ provider: "chats", id: "chats-thinker" });

	const workspace = createChatRecord();
	const recovered = (await handleRequest(
		"session.create",
		{ workspaceId: workspace.id, model: picked, thinkingLevel: "low" },
		CTX,
	)) as WsResult<"session.create">;
	expect(recovered.model).toMatchObject({ provider: "chats", id: "chats-thinker" });
	expect(recovered.thinkingLevel).toBe("low");
	for (const id of [created.workspace.id, workspace.id]) {
		await handleRequest("chat.delete", { workspaceId: id }, CTX);
	}
}, 30_000);

test("two recoveries at once join the one session the first starts, with its real model", async () => {
	const workspace = createChatRecord();
	const hold = holdSessionPreparations();
	try {
		const first = handleRequest("session.create", { workspaceId: workspace.id }, CTX);
		await hold.entered;
		const second = handleRequest("session.create", { workspaceId: workspace.id }, CTX);
		hold.release();
		const [a, b] = (await Promise.all([first, second])) as [
			WsResult<"session.create">,
			WsResult<"session.create">,
		];
		expect(b).toEqual(a);
		expect(b.model).toMatchObject({ provider: "chats", id: "chats-model" });
		expect(hold.sessionIds).toHaveLength(1);
		expect(
			(await listSessions(workspace.id, workspace.worktreePath)).map(
				(summary) => summary.sessionId,
			),
		).toEqual([a.sessionId]);
	} finally {
		hold.restore();
		await handleRequest("chat.delete", { workspaceId: workspace.id }, CTX);
	}
}, 30_000);

test("deleting a chat while its first session is still starting leaves no session behind", async () => {
	const known = new Set(loadChats().chats.map((chat) => chat.id));
	const hold = holdSessionPreparations();
	try {
		const creating = handleRequest("chat.create", {}, CTX);
		creating.catch(() => {});
		await hold.entered;
		const workspaceId = newChatId(known);
		const folder = getChatWorkspace(workspaceId).worktreePath;
		const deleting = handleRequest("chat.delete", { workspaceId }, CTX);
		hold.release();
		await deleting;
		await expect(creating).rejects.toMatchObject({ code: "CHAT_DELETING" });
		expect(hold.sessionIds).toHaveLength(1);
		expect(hasSession(hold.sessionIds[0] ?? "")).toBe(false);
		expect(existsSync(folder)).toBe(false);
		expect(trashed).toContain(folder);
		expect(loadChats().chats.some((chat) => chat.id === workspaceId)).toBe(false);
	} finally {
		hold.restore();
	}
}, 30_000);

test("a chat whose deletion did not finish refuses attach, terminals and sessions after a restart, and Retry completes it", async () => {
	const created = (await handleRequest("chat.create", {}, CTX)) as ChatCreateResult;
	const { workspace, sessionId } = created;
	faux.setResponses([fauxAssistantMessage("kept")]);
	await promptSession(sessionId, "keep this");
	setTrashImplementationForTests(async () => {
		throw new Error("trash unavailable");
	});
	try {
		await expect(handleRequest("chat.delete", { workspaceId: workspace.id }, CTX)).rejects.toThrow(
			"trash unavailable",
		);
	} finally {
		setTrashImplementationForTests(recordTrash);
	}
	expect(getChatWorkspace(workspace.id).deletionPending).toBe(true);
	expect(hasSession(sessionId)).toBe(false);

	disposeAllSessions();
	resetChatIdCache();
	resetChatsStoreForTests();
	for (const [method, params] of [
		["session.getMessages", { workspaceId: workspace.id, sessionId }],
		["session.resources", { workspaceId: workspace.id, sessionId }],
		["session.create", { workspaceId: workspace.id }],
		["terminal.attach", { workspaceId: workspace.id, tabKey: "after-restart" }],
		["terminal.reserve", { workspaceId: workspace.id, tabKey: "after-restart", title: "Shell" }],
	] as const) {
		await expect(handleRequest(method, params, CTX)).rejects.toMatchObject({
			code: "CHAT_DELETION_PENDING",
		});
	}
	expect(hasSession(sessionId)).toBe(false);

	await handleRequest("chat.delete", { workspaceId: workspace.id }, CTX);
	expect(existsSync(workspace.worktreePath)).toBe(false);
	expect(trashed).toContain(workspace.worktreePath);
	expect(trashed.some((path) => path.endsWith(`_${sessionId}.jsonl`))).toBe(true);
	expect(loadChats().chats.some((chat) => chat.id === workspace.id)).toBe(false);
}, 30_000);

test("a chat's delegated conversations go to the Trash with it", async () => {
	const created = (await handleRequest("chat.create", {}, CTX)) as ChatCreateResult;
	const store = join(dataDir, "delegation", created.workspace.id);
	mkdirSync(join(store, created.sessionId), { recursive: true });
	writeFileSync(join(store, created.sessionId, "child.jsonl"), "{}\n");
	await handleRequest("chat.delete", { workspaceId: created.workspace.id }, CTX);
	expect(trashed).toContain(store);
	expect(existsSync(store)).toBe(false);
}, 30_000);

test("chat.inspect counts the files in a chat's folder", async () => {
	const created = (await handleRequest("chat.create", {}, CTX)) as ChatCreateResult;
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
