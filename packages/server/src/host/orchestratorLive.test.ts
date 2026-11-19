import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import {
	createFauxCore,
	fauxAssistantMessage,
	fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux";
import { ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent";
import type {
	Container,
	ContainerOrchestrator,
	Project,
	TranscriptMessage,
	WireCustomMessage,
	Workspace,
} from "@thinkrail/contracts";
import {
	CONTAINER_WAKE_CUSTOM_TYPE,
	ORCHESTRATOR_MESSAGE_CUSTOM_TYPE,
	readContainerNote,
} from "@thinkrail/contracts";
import {
	configurePiRuntime,
	disposeAllSessions,
	getSessionMessages,
	initializeSessionStates,
	isSessionStreaming,
	promptSession,
	setOrchestratorHomeResolver,
	setOrchestratorToolsHost,
	setSessionManagerFactory,
	setSessionPublisher,
	settleSessionsForShutdown,
} from "../agent";
import { setContainerDissolveHook, setContainerPublisher } from "../containers";
import { resetChatsStoreForTests } from "../persistence";
import { resetConfigCache } from "../settings";
import { setTrashImplementationForTests } from "../trash";
import { stopAllWatches } from "../watch";
import { resetChatIdCache } from "../workspaces";
import { handleRequest } from "./handlers";
import {
	disposeContainerOrchestrator,
	orchestratorHomeOf,
	startContainerOrchestrator,
} from "./orchestrator";
import { messageChat, orchestratorToolsHost } from "./orchestratorTools";
import { createOrchestratorWakeups, liveWakeupDeps } from "./orchestratorWakeups";

const CTX = { clientKey: "orchestrator-live-test" };
const symlinks = process.platform !== "win32";

const model = {
	id: "orchestrator-live",
	name: "orchestrator-live",
	reasoning: false,
	input: ["text"] as ("text" | "image")[],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 100_000,
	maxTokens: 4096,
};
const faux = createFauxCore({
	provider: "orchestrator-live",
	api: "orchestrator-live",
	models: [model],
	tokensPerSecond: 10000,
});
const saved = {
	agent: process.env.PI_CODING_AGENT_DIR,
	data: process.env.THINKRAIL_DATA_DIR,
	offline: process.env.PI_OFFLINE,
};
const root = realpathSync.native(mkdtempSync(join(tmpdir(), "trpi-orchestrator-live-")));
const dataDir = join(root, "data");

const projects: Project[] = [
	{ id: "p1", name: "ThinkRail", path: "/repos/thinkrail", slug: "thinkrail", lastOpened: 1 },
];

const members: Workspace[] = ["w1", "w2"].map((id) => ({
	id,
	projectId: "p1",
	kind: "external",
	name: `Workspace ${id}`,
	branch: `branch-${id}`,
	worktreePath: join(root, "worktrees", id),
	baseBranch: "main",
	renamed: true,
}));

const wakeups = createOrchestratorWakeups({ ...liveWakeupDeps, windowMs: 20 });
let container: Container;
let orchestrator: ContainerOrchestrator;

const request = <T>(method: string, params: unknown) =>
	handleRequest(method, params, CTX) as Promise<T>;

async function transcript(workspace: Workspace, sessionId: string): Promise<TranscriptMessage[]> {
	return (await getSessionMessages(sessionId, workspace.id, workspace.worktreePath)).messages;
}

async function until(condition: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 400 && !condition(); attempt++) await Bun.sleep(5);
	expect(condition()).toBe(true);
}

beforeAll(async () => {
	mkdirSync(dataDir, { recursive: true });
	process.env.PI_CODING_AGENT_DIR = join(root, "agent");
	process.env.THINKRAIL_DATA_DIR = dataDir;
	process.env.PI_OFFLINE = "1";
	resetConfigCache();
	resetChatIdCache();
	resetChatsStoreForTests();
	writeFileSync(join(dataDir, "projects.json"), JSON.stringify(projects));
	for (const ws of members) mkdirSync(ws.worktreePath, { recursive: true });
	writeFileSync(join(dataDir, "workspaces.json"), JSON.stringify(members));
	const runtime = await ModelRuntime.create({
		credentials: new InMemoryCredentialStore(),
		modelsPath: null,
		allowModelNetwork: false,
	});
	runtime.registerProvider("orchestrator-live", {
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
		for (const path of typeof input === "string" ? [input] : input)
			rmSync(path, { recursive: true, force: true });
	});
	setContainerPublisher(() => {});
	setContainerDissolveHook(disposeContainerOrchestrator);
	setSessionPublisher((payload, workspaceId) =>
		wakeups.onSessionEvent(payload.sessionId, workspaceId, payload.event),
	);
	setOrchestratorToolsHost(orchestratorToolsHost);
	setOrchestratorHomeResolver(orchestratorHomeOf);
	if (!symlinks) return;
	container = await request<Container>("container.create", {
		name: "Docs everywhere",
		workspaceIds: ["w1", "w2"],
	});
	orchestrator = await startContainerOrchestrator(container.id);
});

afterAll(async () => {
	wakeups.dispose();
	setSessionPublisher(() => {});
	setOrchestratorToolsHost(null);
	setOrchestratorHomeResolver(null);
	if (symlinks) await request("container.remove", { containerId: container.id });
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
	] as const) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
	rmSync(root, { recursive: true, force: true });
});

test.if(symlinks)(
	"message_chat reaches the member as the orchestrator's card, never as a user message, and its turn runs",
	async () => {
		const memberChat = await request<{ sessionId: string }>("session.create", {
			workspaceId: "w2",
		});
		const calls = faux.state.callCount;
		faux.setResponses([fauxAssistantMessage("Rebased."), fauxAssistantMessage("Noted.")]);
		const sent = await messageChat(orchestrator.sessionId, {
			workspace: "Workspace w2",
			text: "Rebase on main.",
		});
		expect(sent).toContain(`(${memberChat.sessionId}) of "Workspace w2" as a follow-up`);
		await until(() => faux.state.callCount === calls + 2);
		await until(() => !wakeups.busy() && !isSessionStreaming(orchestrator.sessionId));
		const messages = await transcript(members[1] as Workspace, memberChat.sessionId);
		expect(messages.map((message) => message.role)).toEqual(["custom", "assistant"]);
		expect(readContainerNote(messages[0])).toEqual({
			kind: "orchestratorMessage",
			details: {
				containerId: container.id,
				containerName: "Docs everywhere",
				orchestratorSessionId: orchestrator.sessionId,
				mode: "follow_up",
				text: "Rebase on main.",
			},
		});
		expect((messages[0] as WireCustomMessage).customType).toBe(ORCHESTRATOR_MESSAGE_CUSTOM_TYPE);
		const woken = await transcript(orchestrator.workspace, orchestrator.sessionId);
		expect(readContainerNote(woken.at(-2))).toMatchObject({
			kind: "wake",
			details: { workspaceId: "w2", reasons: ["chat"] },
		});
	},
	30_000,
);

test.if(symlinks)(
	"a member's settle wakes a streaming orchestrator after its turn, and the orchestrator's own settle wakes nobody",
	async () => {
		const { workspace: home, sessionId } = orchestrator;
		const memberChat = await request<{ sessionId: string }>("session.create", {
			workspaceId: "w1",
		});
		const before = (await transcript(home, sessionId)).length;
		const gate = Promise.withResolvers<void>();
		faux.setResponses([
			async () => {
				await gate.promise;
				return fauxAssistantMessage("ORCH_BUSY");
			},
			fauxAssistantMessage("MEMBER_DONE"),
			fauxAssistantMessage("ORCH_WOKEN"),
		]);
		const busy = promptSession(sessionId, "Plan the split.");
		try {
			await until(() => isSessionStreaming(sessionId));
			await promptSession(memberChat.sessionId, "Finish the board.");
			await until(() => !wakeups.busy());
			expect(
				(await transcript(home, sessionId))
					.slice(before)
					.some((message) => readContainerNote(message)?.kind === "wake"),
			).toBe(false);
		} finally {
			gate.resolve();
		}
		await busy;
		await Bun.sleep(60);
		expect(wakeups.busy()).toBe(false);

		const messages = (await transcript(home, sessionId)).slice(before);
		expect(messages.map((message) => message.role)).toEqual([
			"user",
			"assistant",
			"custom",
			"assistant",
		]);
		const wake = messages[2] as WireCustomMessage<{ workspaceId: string; reasons: string[] }>;
		expect(wake).toMatchObject({
			customType: CONTAINER_WAKE_CUSTOM_TYPE,
			display: true,
			details: { containerId: container.id, workspaceId: "w1", reasons: ["chat"] },
		});
		const text = String(wake.content);
		expect(text).toContain(
			"Member update · ThinkRail · Workspace w1 (branch branch-w1, workspace id w1)",
		);
		expect(text).toContain(`(${memberChat.sessionId}): finished`);
		expect(text).toContain("> MEMBER_DONE");
		expect(JSON.stringify(messages[3])).toContain("ORCH_WOKEN");
	},
	30_000,
);

test.if(symlinks)(
	"the orchestrator's model can call its container tools; a member chat's model has none of them",
	async () => {
		const { workspace: home, sessionId } = orchestrator;
		faux.setResponses([
			fauxAssistantMessage(fauxToolCall("stop_chat", { workspace: "w1" })),
			fauxAssistantMessage("Checked."),
		]);
		await promptSession(sessionId, "Stop the board chat.");
		const stop = (await transcript(home, sessionId)).findLast(
			(message) => message.role === "toolResult",
		);
		expect(stop).toMatchObject({ toolName: "stop_chat", isError: false });
		expect(JSON.stringify(stop)).toContain(
			'Nothing stopped: no chat of \\"Workspace w1\\" is running.',
		);

		const memberChat = await request<{ sessionId: string }>("session.create", {
			workspaceId: "w1",
		});
		faux.setResponses([
			fauxAssistantMessage(fauxToolCall("message_chat", { workspace: "w2", text: "hi" })),
			fauxAssistantMessage("Could not."),
			fauxAssistantMessage("Noted."),
		]);
		await promptSession(memberChat.sessionId, "Tell w2 hi.");
		const refused = (await transcript(members[0] as Workspace, memberChat.sessionId)).find(
			(message) => message.role === "toolResult",
		);
		expect(refused).toMatchObject({ toolName: "message_chat", isError: true });
		expect(JSON.stringify(refused)).toContain("not found");
		await until(() => !wakeups.busy() && !isSessionStreaming(sessionId));
	},
	30_000,
);
