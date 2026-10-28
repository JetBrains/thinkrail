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
import type { ChatContinuation, ChatCreateResult, PiEvent, Workspace } from "@thinkrail/contracts";
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
import { getWorkspace, markChatDeletionPending, resetChatIdCache } from "../workspaces";
import { deleteChat } from "./chats";
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
const pushWaiters = new Set<{
	match: (push: ChatContinuation) => boolean;
	resolve: (push: ChatContinuation) => void;
}>();
const settleWaiters = new Map<string, (() => void)[]>();

function publishForTest(continuation: ChatContinuation): void {
	published.push(continuation);
	for (const waiter of pushWaiters) {
		if (!waiter.match(continuation)) continue;
		pushWaiters.delete(waiter);
		waiter.resolve(continuation);
	}
}

function observeForTest(sessionId: string, event: PiEvent): void {
	observeContinuation(sessionId, event);
	if (event.type !== "agent_settled") return;
	const waiting = settleWaiters.get(sessionId) ?? [];
	settleWaiters.delete(sessionId);
	for (const resolve of waiting) resolve();
}

/** The first push that matches, past or future: no polling, the test's timeout bounds the wait. */
function nextPush(match: (push: ChatContinuation) => boolean): Promise<ChatContinuation> {
	const seen = published.find(match);
	if (seen) return Promise.resolve(seen);
	return new Promise((resolve) => pushWaiters.add({ match, resolve }));
}

function phaseOf(operationId: string, phase: ChatContinuation["phase"]): Promise<ChatContinuation> {
	return nextPush((push) => push.operationId === operationId && push.phase === phase);
}

/** Registered before the action that starts the turn: resolves at that session's next `agent_settled`. */
function nextSettle(sessionId: string): Promise<void> {
	return new Promise((resolve) => {
		settleWaiters.set(sessionId, [...(settleWaiters.get(sessionId) ?? []), resolve]);
	});
}

function continueCall(summary: string) {
	return fauxToolCall(CONTINUE_IN_WORKSPACE_TOOL_NAME, { summary });
}

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
	setContinuationPublisher(publishForTest);
	setSessionPublisher((payload) => observeForTest(payload.sessionId, payload.event));
	await initializeSessionStates([]);
	setTrashImplementationForTests(async (input) => {
		for (const path of typeof input === "string" ? [input] : input) {
			rmSync(path, { recursive: true, force: true });
		}
	});
});

beforeEach(() => {
	published.length = 0;
	pushWaiters.clear();
	settleWaiters.clear();
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

	const started = await phaseOf(operationId, "started");
	expect(started.firstMessage).toBe("sent");
	expect(started.workspaceId).toBeTruthy();
	expect(started.sessionId).toBeTruthy();
	expect(published.map((push) => push.phase)).toContain("creating");
	expect((await continuationStatus(operationId)).phase).toBe("started");

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
			operationId,
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

	const result = await applyContinuation(chat.sessionId, "again");
	expect(result).toContain(`workspace ${started.workspaceId}`);

	resetContinuationsForTests();
	expect(await continuationStatus(operationId)).toEqual({
		operationId,
		sourceWorkspaceId: chat.workspace.id,
		sourceSessionId: chat.sessionId,
		projectId: project.id,
		workspaceId: started.workspaceId ?? "",
		sessionId: started.sessionId ?? "",
		phase: "started",
	});
	await expect(continuationStatus("never-made")).rejects.toMatchObject({
		code: "CONTINUATION_UNKNOWN",
	});
	await expect(applyContinuation(chat.sessionId, "after a restart")).rejects.toThrow(
		"No continuation is pending",
	);
	await handleRequest("chat.delete", { workspaceId: chat.workspace.id }, CTX);
}, 60_000);

test("a turn that settles without the tool fails the operation, a later gesture starts a fresh one, and no binding refuses the tool", async () => {
	const project = openProject(gitRepo(join(root, "repo-b")));
	const chat = (await handleRequest("chat.create", {}, CTX)) as ChatCreateResult;
	faux.setResponses([fauxAssistantMessage("first")]);
	await promptSession(chat.sessionId, "start");

	faux.setResponses([fauxAssistantMessage("I will not call the tool.")]);
	const first = await startContinuation(chat.workspace.id, project.id);
	const failed = await phaseOf(first.operationId, "failed");
	expect(failed.reason).toContain("without a summary");

	await expect(applyContinuation(chat.sessionId, "late summary")).rejects.toThrow(
		"No continuation is pending",
	);
	faux.setResponses([fauxAssistantMessage("Still not calling it.")]);
	const retry = await startContinuation(chat.workspace.id, project.id);
	expect(retry.operationId).not.toBe(first.operationId);
	await phaseOf(retry.operationId, "failed");
	observeContinuation(chat.sessionId, { type: "agent_settled" } as never);
	await expect(
		handleRequest("chat.continue", { workspaceId: chat.workspace.id, projectId: "nope" }, CTX),
	).rejects.toThrow("Pick an open project");
	await handleRequest("chat.delete", { workspaceId: chat.workspace.id }, CTX);
}, 60_000);

function toolResultTexts(messages: readonly unknown[]): string[] {
	return messages.flatMap((message) => {
		const m = message as { role?: string; toolName?: string; content?: { text?: string }[] };
		if (m.role !== "toolResult" || m.toolName !== CONTINUE_IN_WORKSPACE_TOOL_NAME) return [];
		return [(m.content ?? []).map((part) => part.text ?? "").join("")];
	});
}

async function promptedChat(): Promise<ChatCreateResult> {
	const chat = (await handleRequest("chat.create", {}, CTX)) as ChatCreateResult;
	faux.setResponses([fauxAssistantMessage("ready")]);
	await promptSession(chat.sessionId, "start");
	return chat;
}

test("two calls in one response make one workspace, one chat and one link, and both read the same result", async () => {
	const project = openProject(gitRepo(join(root, "repo-parallel")));
	const chat = await promptedChat();
	faux.setResponses([
		fauxAssistantMessage([continueCall("First copy."), continueCall("Second copy.")]),
		fauxAssistantMessage("Handed over."),
		fauxAssistantMessage("Picking up the brief."),
	]);
	const settled = nextSettle(chat.sessionId);
	const { operationId } = await startContinuation(chat.workspace.id, project.id);
	const started = await phaseOf(operationId, "started");
	await settled;

	const rows = (await handleRequest(
		"workspace.list",
		{ projectId: project.id },
		CTX,
	)) as Workspace[];
	expect(rows.filter((row) => row.kind !== "default").map((row) => row.id)).toEqual([
		started.workspaceId ?? "",
	]);
	expect(
		new Set(published.flatMap((push) => (push.workspaceId ? [push.workspaceId] : []))).size,
	).toBe(1);
	expect(
		loadChats()
			.chats.find((candidate) => candidate.id === chat.workspace.id)
			?.continuedTo?.map((link) => link.workspaceId),
	).toEqual([started.workspaceId ?? ""]);
	const results = toolResultTexts(
		(await getSessionMessages(chat.sessionId, chat.workspace.id, chat.workspace.worktreePath))
			.messages,
	);
	expect(results).toHaveLength(2);
	expect(new Set(results).size).toBe(1);
	await handleRequest("chat.delete", { workspaceId: chat.workspace.id }, CTX);
}, 60_000);

test("two gestures at once on a chat whose session is only on disk bind one operation and ask once; another project is refused", async () => {
	const project = openProject(gitRepo(join(root, "repo-detached")));
	const other = openProject(gitRepo(join(root, "repo-detached-other")));
	const chat = await promptedChat();
	disposeAllSessions();
	let release: () => void = () => {};
	const held = new Promise<void>((resolve) => {
		release = resolve;
	});
	faux.setResponses([
		async () => {
			await held;
			return fauxAssistantMessage("No summary this time.");
		},
	]);
	const [first, second, elsewhere] = await Promise.allSettled([
		startContinuation(chat.workspace.id, project.id),
		startContinuation(chat.workspace.id, project.id),
		startContinuation(chat.workspace.id, other.id),
	]);
	if (first.status !== "fulfilled" || second.status !== "fulfilled") {
		throw new Error("the same project's gestures were refused");
	}
	expect(second.value.operationId).toBe(first.value.operationId);
	expect(elsewhere).toMatchObject({
		status: "rejected",
		reason: { code: "CONTINUATION_IN_FLIGHT" },
	});
	await expect(startContinuation(chat.workspace.id, other.id)).rejects.toMatchObject({
		code: "CONTINUATION_IN_FLIGHT",
	});
	expect(await startContinuation(chat.workspace.id, project.id)).toEqual(first.value);
	release();
	await phaseOf(first.value.operationId, "failed");
	expect(new Set(published.map((push) => push.operationId))).toEqual(
		new Set([first.value.operationId]),
	);
	const requests = (
		await getSessionMessages(chat.sessionId, chat.workspace.id, chat.workspace.worktreePath)
	).messages.filter(
		(message) =>
			message.role === "custom" && message.customType === CONTINUE_IN_WORKSPACE_REQUEST_CUSTOM_TYPE,
	);
	expect(requests).toHaveLength(1);
	await handleRequest("chat.delete", { workspaceId: chat.workspace.id }, CTX);
}, 60_000);

test("an empty chat, one whose delete begins while the gesture is admitted and one whose delete did not finish ask nothing", async () => {
	const project = openProject(gitRepo(join(root, "repo-refusals")));
	const empty = (await handleRequest("chat.create", {}, CTX)) as ChatCreateResult;
	await expect(startContinuation(empty.workspace.id, project.id)).rejects.toThrow(
		"no conversation to continue",
	);

	const deleted = await promptedChat();
	const admitting = startContinuation(deleted.workspace.id, project.id);
	const deleting = deleteChat(deleted.workspace.id);
	await expect(admitting).rejects.toMatchObject({ code: "CHAT_DELETING" });
	await deleting;

	const pending = await promptedChat();
	markChatDeletionPending(pending.workspace.id);
	await expect(
		handleRequest(
			"chat.continue",
			{ workspaceId: pending.workspace.id, projectId: project.id },
			CTX,
		),
	).rejects.toMatchObject({ code: "CHAT_DELETION_PENDING" });
	expect(published).toEqual([]);
	await handleRequest("chat.delete", { workspaceId: pending.workspace.id }, CTX);
	await handleRequest("chat.delete", { workspaceId: empty.workspace.id }, CTX);
}, 60_000);

test("a retry reuses the workspace a failed attempt left in the project, and makes a new one once it is removed", async () => {
	const project = openProject(gitRepo(join(root, "repo-retry")));
	const chat = await promptedChat();
	let refuseSessions = false;
	setSessionManagerFactory((cwd) => {
		if (refuseSessions && cwd !== chat.workspace.worktreePath) {
			throw new Error("the session store refused");
		}
		return SessionManager.create(cwd);
	});
	const attempt = async (refuse: boolean): Promise<ChatContinuation> => {
		faux.setResponses([
			() => {
				refuseSessions = refuse;
				return fauxAssistantMessage([continueCall("The brief.")]);
			},
			fauxAssistantMessage("Done."),
			fauxAssistantMessage("Picking up the brief."),
		]);
		const settled = nextSettle(chat.sessionId);
		const { operationId } = await startContinuation(chat.workspace.id, project.id);
		await settled;
		return continuationStatus(operationId);
	};
	try {
		const first = await attempt(true);
		expect(first.phase).toBe("failed");
		expect(first.workspaceId).toBeTruthy();
		expect(await attempt(true)).toMatchObject({ phase: "failed", workspaceId: first.workspaceId });
		await handleRequest("workspace.remove", { id: first.workspaceId ?? "" }, CTX);
		const third = await attempt(false);
		expect(third.phase).toBe("started");
		expect(third.workspaceId).toBeTruthy();
		expect(third.workspaceId).not.toBe(first.workspaceId);
	} finally {
		setSessionManagerFactory((cwd) => SessionManager.create(cwd));
	}
	await handleRequest("chat.delete", { workspaceId: chat.workspace.id }, CTX);
}, 60_000);

test("a project closed between the gesture and the tool fails the operation before anything is created", async () => {
	const project = openProject(gitRepo(join(root, "repo-closed")));
	const chat = await promptedChat();
	faux.setResponses([
		async () => {
			await handleRequest("project.close", { id: project.id }, CTX);
			return fauxAssistantMessage([continueCall("The brief.")]);
		},
		fauxAssistantMessage("The project is gone."),
	]);
	const settled = nextSettle(chat.sessionId);
	const { operationId } = await startContinuation(chat.workspace.id, project.id);
	await settled;
	expect(await continuationStatus(operationId)).toMatchObject({
		phase: "failed",
		reason: "The project is no longer open.",
	});
	expect(published.some((push) => push.workspaceId !== undefined)).toBe(false);
	await handleRequest("chat.delete", { workspaceId: chat.workspace.id }, CTX);
}, 60_000);
