import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import {
	existsSync,
	lstatSync,
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
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { createFauxCore, fauxAssistantMessage } from "@earendil-works/pi-ai/providers/faux";
import { ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent";
import type {
	Container,
	ContainerOrchestrator,
	Project,
	WireCustomMessage,
	Workspace,
} from "@thinkrail/contracts";
import { CONTAINER_BRIEF_CUSTOM_TYPE } from "@thinkrail/contracts";
import {
	configurePiRuntime,
	disposeAllSessions,
	getSessionMessages,
	hasSession,
	initializeSessionStates,
	promptSession,
	setSessionManagerFactory,
	settleSessionsForShutdown,
} from "../agent";
import {
	type ContainerEvent,
	listContainers,
	setContainerDissolveHook,
	setContainerPublisher,
} from "../containers";
import { loadChats, resetChatsStoreForTests } from "../persistence";
import { resetConfigCache } from "../settings";
import { setTrashImplementationForTests } from "../trash";
import { stopAllWatches } from "../watch";
import { resetChatIdCache } from "../workspaces";
import { applyGitCeiling } from "./gitCeiling";
import { handleRequest } from "./handlers";
import {
	disposeContainerOrchestrator,
	orchestratorHomeOf,
	startContainerOrchestrator,
} from "./orchestrator";

const CTX = { clientKey: "orchestrator-test" };
const symlinks = process.platform !== "win32";

const model = {
	id: "orchestrator-model",
	name: "orchestrator-model",
	reasoning: false,
	input: ["text"] as ("text" | "image")[],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 100_000,
	maxTokens: 4096,
};
const faux = createFauxCore({
	provider: "orchestrator",
	api: "orchestrator",
	models: [model],
	tokensPerSecond: 10000,
});
const saved = {
	agent: process.env.PI_CODING_AGENT_DIR,
	data: process.env.THINKRAIL_DATA_DIR,
	offline: process.env.PI_OFFLINE,
	ceiling: process.env.GIT_CEILING_DIRECTORIES,
};
const root = realpathSync.native(mkdtempSync(join(tmpdir(), "trpi-orchestrator-")));
const dataDir = join(root, "enclosing-repo", "data");
const trashed: string[] = [];
let events: ContainerEvent[] = [];

const projects: Project[] = [
	{ id: "p1", name: "ThinkRail", path: "/repos/thinkrail", slug: "thinkrail", lastOpened: 1 },
	{ id: "p2", name: "Website", path: "/repos/website", slug: "website", lastOpened: 1 },
];

function member(id: string, projectId: string, branch: string): Workspace {
	return {
		id,
		projectId,
		kind: "external",
		name: `Workspace ${id}`,
		branch,
		worktreePath: join(root, "worktrees", id),
		baseBranch: "main",
		renamed: true,
		review: { kind: "pull-request", number: 7, state: "open", url: "https://pr/7" },
	};
}

const members = [member("w1", "p1", "board"), member("w2", "p2", "docs"), member("w3", "p1", "x")];

function git(cwd: string, ...args: string[]): boolean {
	return Bun.spawnSync(["git", "-C", cwd, ...args], {
		stdout: "pipe",
		stderr: "pipe",
		env: { ...process.env },
	}).success;
}

const request = <T>(method: string, params: unknown) =>
	handleRequest(method, params, CTX) as Promise<T>;

beforeAll(async () => {
	mkdirSync(join(root, "enclosing-repo"), { recursive: true });
	git(join(root, "enclosing-repo"), "init", "-q", "-b", "main");
	mkdirSync(dataDir, { recursive: true });
	process.env.PI_CODING_AGENT_DIR = join(root, "agent");
	process.env.THINKRAIL_DATA_DIR = dataDir;
	process.env.PI_OFFLINE = "1";
	delete process.env.GIT_CEILING_DIRECTORIES;
	resetConfigCache();
	resetChatIdCache();
	resetChatsStoreForTests();
	writeFileSync(join(dataDir, "projects.json"), JSON.stringify(projects));
	for (const ws of members) {
		mkdirSync(ws.worktreePath, { recursive: true });
		writeFileSync(join(ws.worktreePath, "README.md"), `# ${ws.id}\n`);
	}
	writeFileSync(join(dataDir, "workspaces.json"), JSON.stringify(members));
	const runtime = await ModelRuntime.create({
		credentials: new InMemoryCredentialStore(),
		modelsPath: null,
		allowModelNetwork: false,
	});
	runtime.registerProvider("orchestrator", {
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
	setContainerPublisher((event) => events.push(event));
	setContainerDissolveHook(disposeContainerOrchestrator);
});

beforeEach(() => {
	events = [];
	trashed.length = 0;
});

afterAll(async () => {
	setContainerPublisher(null);
	setContainerDissolveHook(null);
	setTrashImplementationForTests(undefined);
	stopAllWatches();
	await settleSessionsForShutdown();
	disposeAllSessions();
	configurePiRuntime(null);
	resetChatIdCache();
	resetChatsStoreForTests();
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

const homeOf = (container: Container) => join(dataDir, "containers", container.id);
const orchestratorChats = () => loadChats().chats.filter((chat) => chat.orchestratorOf);

async function messagesOf(started: ContainerOrchestrator) {
	const { workspace, sessionId } = started;
	return (await getSessionMessages(sessionId, workspace.id, workspace.worktreePath)).messages;
}

test.if(symlinks)(
	"a container of two gets a seeded orchestrator in its home without a model turn; one of one gets none",
	async () => {
		const memberChat = await request<{ sessionId: string }>("session.create", {
			workspaceId: "w1",
		});
		faux.setResponses([fauxAssistantMessage("done")]);
		await promptSession(memberChat.sessionId, "finish the board");
		const calls = faux.state.callCount;
		const single = await request<Container>("container.create", { workspaceIds: ["w3"] });
		const pair = await request<Container>("container.create", {
			name: "Docs everywhere",
			workspaceIds: ["w1", "w2"],
		});
		const started = await startContainerOrchestrator(pair.id);
		await Bun.sleep(20);
		try {
			expect(orchestratorChats().map((chat) => chat.orchestratorOf)).toEqual([pair.id]);
			expect(listContainers().find((c) => c.id === single.id)?.orchestratorSessionId).toBe(
				undefined,
			);
			expect(started.workspace).toMatchObject({
				kind: "chat",
				name: "Orchestrator · Docs everywhere",
				worktreePath: homeOf(pair),
				orchestratorOf: pair.id,
				branch: "",
			});
			expect(started.container.orchestratorSessionId).toBe(started.sessionId);
			expect(listContainers().find((c) => c.id === pair.id)?.orchestratorSessionId).toBe(
				started.sessionId,
			);
			expect(events.at(-1)).toEqual({ kind: "updated", container: started.container });
			expect(orchestratorHomeOf(started.workspace.id)).toBe(homeOf(pair));
			expect(orchestratorHomeOf("w1")).toBeNull();

			const messages = await messagesOf(started);
			expect(messages.map((message) => message.role)).toEqual(["custom"]);
			const brief = messages[0] as WireCustomMessage<{ containerId: string }>;
			expect(brief).toMatchObject({
				customType: CONTAINER_BRIEF_CUSTOM_TYPE,
				display: true,
				details: { containerId: pair.id },
			});
			const text = String(brief.content);
			expect(text).toContain('container "Docs everywhere"');
			expect(text).toContain("- ThinkRail · Workspace w1 — branch board · PR #7 open");
			expect(text).toContain(
				`  - chat unnamed, first prompt "finish the board" (${memberChat.sessionId}): finished`,
			);
			expect(text).toContain("- Website · Workspace w2 — branch docs");
			expect(text).toContain("no chats");
			expect(faux.state.callCount).toBe(calls);

			const again = await request<ContainerOrchestrator>("container.startOrchestrator", {
				containerId: pair.id,
			});
			expect(again.sessionId).toBe(started.sessionId);
			expect(orchestratorChats()).toHaveLength(1);
		} finally {
			await request("container.remove", { containerId: single.id });
			await request("container.remove", { containerId: pair.id });
		}
	},
	30_000,
);

test.if(symlinks)(
	"the add that brings a container to two members starts its orchestrator; a manual start works for one",
	async () => {
		const container = await request<Container>("container.create", { workspaceIds: ["w1"] });
		await Bun.sleep(20);
		expect(orchestratorChats()).toEqual([]);
		await request("container.addWorkspace", { containerId: container.id, workspaceId: "w2" });
		const started = await startContainerOrchestrator(container.id);
		expect(started.workspace.orchestratorOf).toBe(container.id);
		await request("container.removeWorkspace", { containerId: container.id, workspaceId: "w2" });
		await request("container.addWorkspace", { containerId: container.id, workspaceId: "w3" });
		expect(orchestratorChats()).toHaveLength(1);
		await request("container.remove", { containerId: container.id });

		const lone = await request<Container>("container.create", { workspaceIds: ["w3"] });
		const manual = await request<ContainerOrchestrator>("container.startOrchestrator", {
			containerId: lone.id,
		});
		expect(manual.container.orchestratorSessionId).toBe(manual.sessionId);
		await request("container.remove", { containerId: lone.id });
		await expect(
			request("container.startOrchestrator", { containerId: lone.id }),
		).rejects.toMatchObject({ code: "CONTAINER_UNKNOWN" });
	},
	30_000,
);

test.if(symlinks)(
	"dissolving a container deletes its orchestrator like a chat and leaves every member untouched",
	async () => {
		const container = await request<Container>("container.create", { workspaceIds: ["w1", "w2"] });
		const started = await startContainerOrchestrator(container.id);
		faux.setResponses([fauxAssistantMessage("noted")]);
		await promptSession(started.sessionId, "remember the plan");
		const home = homeOf(container);
		writeFileSync(join(home, ".thinkrail", "context", "plan.md"), "# plan\n");

		await request("container.remove", { containerId: container.id });
		expect(hasSession(started.sessionId)).toBe(false);
		expect(orchestratorChats()).toEqual([]);
		expect(trashed.some((path) => path.endsWith(`_${started.sessionId}.jsonl`))).toBe(true);
		expect(trashed).toContain(home);
		expect(existsSync(home)).toBe(false);
		for (const ws of members.slice(0, 2)) {
			expect(readFileSync(join(ws.worktreePath, "README.md"), "utf8")).toBe(`# ${ws.id}\n`);
		}
		const stored = JSON.parse(readFileSync(join(dataDir, "workspaces.json"), "utf8"));
		expect(stored).toHaveLength(members.length);
	},
	30_000,
);

test.if(symlinks)(
	"deleting the orchestrator chat unlinks it and keeps the container and its home",
	async () => {
		const container = await request<Container>("container.create", { workspaceIds: ["w1", "w2"] });
		const started = await startContainerOrchestrator(container.id);
		await request("chat.delete", { workspaceId: started.workspace.id });
		const kept = listContainers().find((candidate) => candidate.id === container.id);
		expect(kept?.workspaceIds).toEqual(["w1", "w2"]);
		expect(kept?.orchestratorSessionId).toBeUndefined();
		expect(orchestratorChats()).toEqual([]);
		expect(readdirSync(join(homeOf(container), "workspaces")).sort()).toEqual([
			"thinkrail-board",
			"website-docs",
		]);
		expect(trashed).not.toContain(homeOf(container));
		await request("container.remove", { containerId: container.id });
	},
	30_000,
);

test.if(symlinks)(
	"git finds no repository in the home, and every repository door refuses the orchestrator",
	async () => {
		applyGitCeiling();
		const container = await request<Container>("container.create", { workspaceIds: ["w1", "w2"] });
		const started = await startContainerOrchestrator(container.id);
		const home = homeOf(container);
		try {
			expect(git(join(root, "enclosing-repo"), "rev-parse", "--show-toplevel")).toBe(true);
			expect(lstatSync(join(home, "workspaces", "thinkrail-board")).isSymbolicLink()).toBe(true);
			for (const cwd of [home, join(home, "workspaces"), join(home, ".thinkrail", "context")]) {
				expect(git(cwd, "rev-parse", "--show-toplevel")).toBe(false);
			}
			for (const [method, params] of [
				["git.status", { workspaceId: started.workspace.id }],
				["workspace.setDiffBase", { id: started.workspace.id, ref: "main" }],
			] as const) {
				await expect(handleRequest(method, params, CTX)).rejects.toThrow("asked about git");
			}
			await expect(
				handleRequest("spec.graph", { workspaceId: started.workspace.id }, CTX),
			).rejects.toMatchObject({ code: "CHAT_WORKSPACE" });
		} finally {
			await request("container.remove", { containerId: container.id });
		}
	},
	30_000,
);
