import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import {
	createFauxCore,
	fauxAssistantMessage,
	fauxText,
	fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux";
import { ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent";
import type { ChatContinuation, ChatCreateResult, Workspace } from "@thinkrail/contracts";
import {
	CHAT_HANDOFF_CUSTOM_TYPE,
	CONTINUE_IN_WORKSPACE_REQUEST_CUSTOM_TYPE,
} from "@thinkrail/contracts";
import {
	CONTINUE_IN_WORKSPACE_TOOL_NAME,
	configurePiRuntime,
	disposeAllSessions,
	getSessionMessages,
	initializeSessionStates,
	promptSession,
	setContinueToolHost,
	setSessionManagerFactory,
	setSessionPublisher,
	settleSessionsForShutdown,
} from "../agent";
import { loadChats } from "../persistence";
import { openProject } from "../projects";
import { resetConfigCache } from "../settings";
import { setTrashImplementationForTests } from "../trash";
import { stopAllWatches } from "../watch";
import { getWorkspace, resetChatIdCache } from "../workspaces";
import {
	applyContinuation,
	continuationStatus,
	continueToolHost,
	observeContinuation,
	resetContinuationsForTests,
	setContinuationPublisher,
	startContinuation,
} from "./continuations";
import { handleRequest } from "./handlers";

const CTX = { clientKey: "continuation-test" };

const model = {
	id: "continue-model",
	name: "continue-model",
	reasoning: false,
	input: ["text"] as ("text" | "image")[],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 100_000,
	maxTokens: 4096,
};
const faux = createFauxCore({
	provider: "continue",
	api: "continue",
	models: [model],
	tokensPerSecond: 10000,
});
const saved = {
	agent: process.env.PI_CODING_AGENT_DIR,
	data: process.env.THINKRAIL_DATA_DIR,
	offline: process.env.PI_OFFLINE,
};
const root = realpathSync.native(mkdtempSync(join(tmpdir(), "trpi-continuations-")));
const published: ChatContinuation[] = [];

function git(cwd: string, ...args: string[]): void {
	const result = Bun.spawnSync(["git", "-C", cwd, ...args], { stdout: "ignore", stderr: "pipe" });
	if (!result.success) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
}

function gitRepo(path: string): string {
	mkdirSync(path, { recursive: true });
	git(path, "init", "-b", "main");
	git(path, "config", "user.email", "t@thinkrail.test");
	git(path, "config", "user.name", "test");
	git(path, "config", "commit.gpgsign", "false");
	writeFileSync(join(path, "README.md"), "# repo\n");
	git(path, "add", "-A");
	git(path, "commit", "-m", "init");
	return path;
}

async function waitFor<T>(read: () => T | undefined, label: string, tries = 200): Promise<T> {
	for (let attempt = 0; attempt < tries; attempt += 1) {
		const value = read();
		if (value !== undefined) return value;
		await Bun.sleep(25);
	}
	throw new Error(`timed out waiting for ${label}`);
}

beforeAll(async () => {
	process.env.PI_CODING_AGENT_DIR = join(root, "agent");
	process.env.THINKRAIL_DATA_DIR = join(root, "data");
	process.env.PI_OFFLINE = "1";
	resetConfigCache();
	resetChatIdCache();
	const runtime = await ModelRuntime.create({
		credentials: new InMemoryCredentialStore(),
		modelsPath: null,
		allowModelNetwork: false,
	});
	runtime.registerProvider("continue", {
		api: faux.api,
		apiKey: "test",
		baseUrl: "http://faux.local",
		streamSimple: faux.streamSimple,
		models: [{ ...model, api: faux.api }],
	});
	configurePiRuntime(runtime);
	setSessionManagerFactory((cwd) => SessionManager.create(cwd));
	setContinueToolHost(continueToolHost);
	setContinuationPublisher((continuation) => published.push(continuation));
	setSessionPublisher((payload) => observeContinuation(payload.sessionId, payload.event));
	await initializeSessionStates([]);
	setTrashImplementationForTests(async (input) => {
		for (const path of typeof input === "string" ? [input] : input) {
			rmSync(path, { recursive: true, force: true });
		}
	});
});

beforeEach(() => {
	published.length = 0;
	resetContinuationsForTests();
});

afterAll(async () => {
	setContinueToolHost(null);
	setContinuationPublisher(null);
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
	] as const) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
	rmSync(root, { recursive: true, force: true });
});

test("the source chat's agent summarizes and the tool creates the workspace, its chat, the handoff and the link", async () => {
	const project = openProject(gitRepo(join(root, "repo-a")));
	const chat = (await handleRequest("chat.create", {}, CTX)) as ChatCreateResult;
	faux.setResponses([fauxAssistantMessage("hello from the scratch chat")]);
	await promptSession(chat.sessionId, "say hello");

	faux.setResponses([
		fauxAssistantMessage([
			fauxText("Handing over."),
			fauxToolCall(CONTINUE_IN_WORKSPACE_TOOL_NAME, {
				summary: "The user said hello; nothing is open.",
			}),
		]),
		fauxAssistantMessage("Done — continued in the workspace."),
		fauxAssistantMessage("Picking up the brief."),
	]);
	const { operationId } = (await handleRequest(
		"chat.continue",
		{ workspaceId: chat.workspace.id, projectId: project.id },
		CTX,
	)) as { operationId: string };
	expect(published.map((push) => push.phase).slice(0, 2)).toEqual(["requested", "summarizing"]);

	const started = await waitFor(
		() => published.find((push) => push.operationId === operationId && push.phase === "started"),
		"the started phase",
	);
	expect(started.firstMessage).toBe("sent");
	expect(started.workspaceId).toBeTruthy();
	expect(started.sessionId).toBeTruthy();
	expect(published.map((push) => push.phase)).toContain("creating");
	expect(continuationStatus(operationId).phase).toBe("started");

	const rows = (await handleRequest(
		"workspace.list",
		{ projectId: project.id },
		CTX,
	)) as Workspace[];
	const created = rows.find((row) => row.id === started.workspaceId);
	expect(created?.kind).toBeUndefined();
	expect(created?.projectId).toBe(project.id);

	const link = loadChats().chats.find(
		(candidate) => candidate.id === chat.workspace.id,
	)?.continuedTo;
	expect(link).toEqual([
		{
			projectId: project.id,
			workspaceId: started.workspaceId ?? "",
			sessionId: started.sessionId ?? "",
		},
	]);

	const sourceMessages = await getSessionMessages(
		chat.sessionId,
		chat.workspace.id,
		chat.workspace.worktreePath,
	);
	expect(
		sourceMessages.messages.some(
			(message) =>
				message.role === "custom" &&
				message.customType === CONTINUE_IN_WORKSPACE_REQUEST_CUSTOM_TYPE,
		),
	).toBe(true);
	const target = getWorkspace(started.workspaceId ?? "");
	const targetSessionId = started.sessionId ?? "";
	const targetMessages = (await getSessionMessages(targetSessionId, target.id, target.worktreePath))
		.messages;
	const handoff = targetMessages.find(
		(message) => message.role === "custom" && message.customType === CHAT_HANDOFF_CUSTOM_TYPE,
	) as { details?: { summary?: string; sourceSessionId?: string } } | undefined;
	expect(handoff?.details).toMatchObject({
		summary: "The user said hello; nothing is open.",
		sourceSessionId: chat.sessionId,
	});

	await expect(applyContinuation(chat.sessionId, "again")).resolves.toContain("Already continued");
	await handleRequest("chat.delete", { workspaceId: chat.workspace.id }, CTX);
}, 60_000);

test("a turn that settles without the tool fails the operation, a later gesture starts a fresh one, and no binding refuses the tool", async () => {
	const project = openProject(gitRepo(join(root, "repo-b")));
	const chat = (await handleRequest("chat.create", {}, CTX)) as ChatCreateResult;
	faux.setResponses([fauxAssistantMessage("first")]);
	await promptSession(chat.sessionId, "start");

	faux.setResponses([fauxAssistantMessage("I will not call the tool.")]);
	const first = await startContinuation(chat.workspace.id, project.id);
	const failed = await waitFor(
		() =>
			published.find((push) => push.operationId === first.operationId && push.phase === "failed"),
		"the failed phase",
	);
	expect(failed.reason).toContain("without a summary");

	await expect(applyContinuation(chat.sessionId, "late summary")).rejects.toThrow(
		"No continuation is pending",
	);
	faux.setResponses([fauxAssistantMessage("Still not calling it.")]);
	const retry = await startContinuation(chat.workspace.id, project.id);
	expect(retry.operationId).not.toBe(first.operationId);
	await waitFor(
		() =>
			published.find((push) => push.operationId === retry.operationId && push.phase === "failed"),
		"the retry's failed phase",
	);
	observeContinuation(chat.sessionId, { type: "agent_settled" } as never);
	await expect(
		handleRequest("chat.continue", { workspaceId: chat.workspace.id, projectId: "nope" }, CTX),
	).rejects.toThrow("Pick an open project");
	await handleRequest("chat.delete", { workspaceId: chat.workspace.id }, CTX);
}, 60_000);
