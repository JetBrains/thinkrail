import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { createFauxCore, fauxAssistantMessage } from "@earendil-works/pi-ai/providers/faux";
import { ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent";
import { recordResource, resourceHistoryRoot } from "../resourceHistory";
import {
	clearQueueSession,
	compactSession,
	createSession,
	disposeAllSessions,
	followUpSession,
	getSessionMessages,
	getSessionState,
	promptSession,
	reloadSessionResources,
	removeSession,
	setSessionManagerFactory,
	setSkillAdmissionResolver,
	settleSessionsForShutdown,
	toWireModel,
} from "./agentSessionManager";
import { getSessionResources } from "./chatResources";
import { configurePiRuntime } from "./piRuntime";
import { admissionContextFor } from "./skillAdmission";

const noticeType = "thinkrail/resource-interruptions";
const model = {
	id: "interruptions",
	name: "interruptions",
	reasoning: false,
	input: ["text"] as ("text" | "image")[],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 100_000,
	maxTokens: 4096,
};
const faux = createFauxCore({
	provider: "interruptions",
	api: "interruptions",
	models: [model],
	tokensPerSecond: 10000,
});
const root = mkdtempSync(join(tmpdir(), "resource-interruptions-"));
const saved = {
	agent: process.env.PI_CODING_AGENT_DIR,
	data: process.env.THINKRAIL_DATA_DIR,
	offline: process.env.PI_OFFLINE,
};
let sequence = 0;

beforeAll(async () => {
	process.env.PI_CODING_AGENT_DIR = join(root, "agent");
	process.env.THINKRAIL_DATA_DIR = join(root, "data");
	process.env.PI_OFFLINE = "1";
	const runtime = await ModelRuntime.create({
		credentials: new InMemoryCredentialStore(),
		modelsPath: null,
		allowModelNetwork: false,
	});
	runtime.registerProvider("interruptions", {
		api: faux.api,
		apiKey: "test",
		baseUrl: "http://faux.local",
		streamSimple: faux.streamSimple,
		models: [{ ...model, api: faux.api }],
	});
	configurePiRuntime(runtime);
	setSessionManagerFactory((cwd) => SessionManager.create(cwd));
	setSkillAdmissionResolver(() => admissionContextFor({ piResourceTrust: "granted" }));
});

afterAll(async () => {
	await settleSessionsForShutdown();
	disposeAllSessions();
	configurePiRuntime(null);
	setSessionManagerFactory((cwd) => SessionManager.create(cwd));
	setSkillAdmissionResolver(() => admissionContextFor(undefined));
	for (const [name, value] of [
		["PI_CODING_AGENT_DIR", saved.agent],
		["THINKRAIL_DATA_DIR", saved.data],
		["PI_OFFLINE", saved.offline],
	] as const) {
		if (value === undefined) delete process.env[name];
		else process.env[name] = value;
	}
	rmSync(root, { recursive: true, force: true });
});

async function parent(primer = "Remember this chat.") {
	const cwd = mkdtempSync(join(root, "cwd-"));
	mkdirSync(join(cwd, ".pi"));
	writeFileSync(
		join(cwd, ".pi", "settings.json"),
		JSON.stringify({ compaction: { enabled: false, keepRecentTokens: 1, reserveTokens: 4096 } }),
	);
	const workspaceId = `interruptions-${++sequence}`;
	const { sessionId } = await createSession({
		workspaceId,
		cwd,
		model: toWireModel(faux.getModel()),
	});
	faux.setResponses([fauxAssistantMessage("READY")]);
	await promptSession(sessionId, primer);
	return { workspaceId, sessionId, cwd };
}

type Parent = Awaited<ReturnType<typeof parent>>;

function command(p: Parent, id: string, status: "running" | "completed" | "stopped" = "running") {
	recordResource(p, {
		kind: "command",
		summary: {
			id,
			sessionId: p.sessionId,
			name: id,
			command: `bun run ${id}`,
			status,
			startedAt: 1_000,
			...(status === "completed" ? { exitCode: 0 } : {}),
		},
	});
}

async function noticeMessages(p: Parent) {
	await getSessionMessages(p.sessionId, p.workspaceId, p.cwd);
	const info = (await SessionManager.list(p.cwd)).find((row) => row.id === p.sessionId);
	if (!info) throw new Error("missing persisted parent");
	return SessionManager.open(info.path)
		.getBranch()
		.filter((entry) => entry.type === "custom_message" && entry.customType === noticeType);
}

test("restart interruptions reach the next user request once, without waking an inspected chat", async () => {
	const p = await parent();
	command(p, "lost-command");
	recordResource(p, {
		kind: "subagent",
		summary: {
			childSessionId: "lost-child",
			parentSessionId: p.sessionId,
			roleName: "researcher",
			task: "Inspect the restart schema",
			status: "running",
			detached: true,
			createdAt: new Date(2_000).toISOString(),
		},
	});
	await removeSession(p.sessionId);
	let requests = 0;
	let providerInput = "";
	faux.setResponses([
		(context) => {
			requests++;
			providerInput = JSON.stringify(context.messages);
			return fauxAssistantMessage("CONTINUED");
		},
	]);
	const resources = await getSessionResources(p.workspaceId, p.sessionId, p.cwd);
	expect(resources.commands[0]?.interrupted).toBe(true);
	expect(resources.subagents[0]?.interrupted).toBe(true);
	expect(requests).toBe(0);
	expect(await noticeMessages(p)).toEqual([]);
	await promptSession(p.sessionId, "Continue the task.");
	expect(requests).toBe(1);
	expect(providerInput).toContain("bun run lost-command");
	expect(providerInput).toContain("Inspect the restart schema");
	expect(await noticeMessages(p)).toHaveLength(1);
	await reloadSessionResources(p.sessionId);
	await removeSession(p.sessionId);
	await getSessionResources(p.workspaceId, p.sessionId, p.cwd);
	faux.setResponses([fauxAssistantMessage("AGAIN")]);
	await promptSession(p.sessionId, "Continue again.");
	expect(await noticeMessages(p)).toHaveLength(1);
	await removeSession(p.sessionId);
});

test("ordinary finished work and foreground children do not become restart notices", async () => {
	const p = await parent();
	command(p, "completed-command", "completed");
	command(p, "user-stopped-command", "stopped");
	recordResource(p, {
		kind: "subagent",
		summary: {
			childSessionId: "foreground-child",
			parentSessionId: p.sessionId,
			task: "Foreground task",
			status: "running",
			createdAt: new Date(2_000).toISOString(),
		},
	});
	await removeSession(p.sessionId);
	await getSessionResources(p.workspaceId, p.sessionId, p.cwd);
	faux.setResponses([fauxAssistantMessage("NO NOTICE")]);
	await promptSession(p.sessionId, "Continue.");
	expect(await noticeMessages(p)).toEqual([]);
	await removeSession(p.sessionId);
});

test("notices drain history beyond the UI window, confirming only each bounded batch", async () => {
	const p = await parent();
	for (let i = 0; i < 25; i++) command(p, `old-${String(i).padStart(2, "0")}`);
	const resources = await getSessionResources(p.workspaceId, p.sessionId, p.cwd);
	expect(resources.commands).toHaveLength(20);
	faux.setResponses([fauxAssistantMessage("FIRST")]);
	await promptSession(p.sessionId, "Continue.");
	const first = await noticeMessages(p);
	expect(first).toHaveLength(1);
	expect(first[0]).toMatchObject({ details: { resourceIds: expect.any(Array) } });
	expect(JSON.stringify(first)).toContain("5 more interrupted records");
	faux.setResponses([fauxAssistantMessage("SECOND")]);
	await promptSession(p.sessionId, "Continue the rest.");
	const second = await noticeMessages(p);
	expect(second).toHaveLength(2);
	const serialized = JSON.stringify(second);
	for (let i = 0; i < 25; i++)
		expect(
			serialized.match(new RegExp(`command:old-${String(i).padStart(2, "0")}`, "g")),
		).toHaveLength(1);
	faux.setResponses([fauxAssistantMessage("THIRD")]);
	await promptSession(p.sessionId, "Nothing new.");
	expect(await noticeMessages(p)).toHaveLength(2);
	await removeSession(p.sessionId);
});

test("compaction keeps notification receipts and later interruptions still get reported", async () => {
	const p = await parent();
	command(p, "before-compaction");
	faux.setResponses([fauxAssistantMessage("NOTIFIED")]);
	await promptSession(p.sessionId, "Continue before compaction.");
	expect(await noticeMessages(p)).toHaveLength(1);
	faux.setResponses([
		fauxAssistantMessage("The earlier background work was interrupted."),
		fauxAssistantMessage("The user wants to continue after interruption."),
	]);
	await compactSession(p.sessionId);
	await removeSession(p.sessionId);
	await getSessionResources(p.workspaceId, p.sessionId, p.cwd);
	command(p, "after-compaction");
	faux.setResponses([fauxAssistantMessage("CONTINUED")]);
	await promptSession(p.sessionId, "Continue after compaction.");
	const messages = await noticeMessages(p);
	expect(messages).toHaveLength(2);
	expect(JSON.stringify(messages[1])).not.toContain("before-compaction");
	expect(JSON.stringify(messages[1])).toContain("after-compaction");
	await removeSession(p.sessionId);
});

test("handled inputs and TODO control prompts leave interruption notices for the user", async () => {
	const p = await parent();
	const extensions = join(p.cwd, ".pi", "extensions");
	mkdirSync(extensions, { recursive: true });
	writeFileSync(
		join(extensions, "handled-input.ts"),
		'export default function(pi) { pi.registerCommand("noop", { description: "No-op", handler: async () => {} }); pi.on("input", (event) => event.text === "HANDLED" ? { action: "handled" } : undefined); }',
	);
	await reloadSessionResources(p.sessionId);
	command(p, "pending-for-user");
	await promptSession(p.sessionId, "/noop");
	await promptSession(p.sessionId, "HANDLED");
	expect(await noticeMessages(p)).toEqual([]);
	faux.setResponses([fauxAssistantMessage("CONTROL")]);
	await promptSession(p.sessionId, "[thinkrail:todo-nudge] Continue internally.");
	expect(await noticeMessages(p)).toEqual([]);
	faux.setResponses([fauxAssistantMessage("USER")]);
	await promptSession(p.sessionId, "Please continue.");
	expect(await noticeMessages(p)).toHaveLength(1);
	await removeSession(p.sessionId);
});

test("large escaped task data stays bounded and an already stopped interrupted command is included", async () => {
	const p = await parent();
	for (let i = 0; i < 8; i++)
		recordResource(p, {
			kind: "command",
			summary: {
				id: `large-${i}`,
				sessionId: p.sessionId,
				name: "\u0001".repeat(200),
				command: "\u0001".repeat(1_000),
				status: "stopped",
				interrupted: true,
				startedAt: 1_000,
			},
		});
	faux.setResponses([fauxAssistantMessage("BOUNDED")]);
	await promptSession(p.sessionId, "Continue.");
	const first = (await noticeMessages(p))[0];
	if (first?.type !== "custom_message" || typeof first.content !== "string")
		throw new Error("missing notice");
	expect(first.display).toBe(false);
	expect(first.content.length).toBeLessThanOrEqual(12_000);
	expect(first.content).toContain('"commandTruncated":true');
	expect(first.content).toContain("more interrupted records");
	await removeSession(p.sessionId);
});

test("an automatic custom-message turn does not consume a pending interruption notice", async () => {
	const p = await parent();
	const extensions = join(p.cwd, ".pi", "extensions");
	mkdirSync(extensions, { recursive: true });
	writeFileSync(
		join(extensions, "custom-turn.ts"),
		'export default function(pi) { pi.registerCommand("automatic", { description: "Test automatic turn", handler: async () => { pi.sendMessage({ customType: "test/automatic", content: "AUTOMATIC", display: false }, { triggerTurn: true }); } }); }',
	);
	await reloadSessionResources(p.sessionId);
	command(p, "still-pending");
	const before = faux.state.callCount;
	faux.setResponses([fauxAssistantMessage("AUTOMATIC RESPONSE")]);
	await promptSession(p.sessionId, "/automatic");
	const deadline = Date.now() + 5_000;
	while (faux.state.callCount === before || getSessionState(p.sessionId).execution === "running") {
		if (Date.now() > deadline) throw new Error("automatic fixture turn did not settle");
		await Bun.sleep(5);
	}
	expect(await noticeMessages(p)).toEqual([]);
	faux.setResponses([fauxAssistantMessage("USER RESPONSE")]);
	await promptSession(p.sessionId, "Continue as requested.");
	expect(await noticeMessages(p)).toHaveLength(1);
	await removeSession(p.sessionId);
});

test("unknown or malformed receipt metadata cannot suppress a real interruption", async () => {
	const p = await parent();
	command(p, "unreported");
	await removeSession(p.sessionId);
	const info = (await SessionManager.list(p.cwd)).find((row) => row.id === p.sessionId);
	if (!info) throw new Error("missing persisted parent");
	const disk = SessionManager.open(info.path);
	for (const details of [
		null,
		{ version: 1, resourceIds: 42 },
		{ version: 2, resourceIds: ["command:unreported"] },
	])
		disk.appendCustomMessageEntry(noticeType, "Older notification metadata", false, details);
	await getSessionResources(p.workspaceId, p.sessionId, p.cwd);
	faux.setResponses([fauxAssistantMessage("REPORTED")]);
	await promptSession(p.sessionId, "Continue.");
	const entries = await noticeMessages(p);
	expect(entries).toHaveLength(4);
	expect(entries.at(-1)).toMatchObject({
		details: { version: 1, resourceIds: ["command:unreported"] },
	});
	await removeSession(p.sessionId);
});

test("malformed optional archive data cannot block valid interruption notices", async () => {
	const p = await parent(
		"[thinkrail:todo-nudge] Persist without reading user interruption notices.",
	);
	const dir = join(resourceHistoryRoot(), p.workspaceId, p.sessionId);
	mkdirSync(dir, { recursive: true });
	writeFileSync(
		join(dir, "index.jsonl"),
		`${JSON.stringify({
			kind: "subagent",
			summary: {
				childSessionId: "bad-role",
				parentSessionId: p.sessionId,
				roleName: 42,
				task: "archived task",
				status: "running",
				detached: true,
				createdAt: new Date(2000).toISOString(),
			},
		})}\n`,
	);
	const resources = await getSessionResources(p.workspaceId, p.sessionId, p.cwd);
	expect(resources.subagents).toHaveLength(1);
	command(p, "valid-interruption");
	let input = "";
	faux.setResponses([
		(context) => {
			input = JSON.stringify(context.messages);
			return fauxAssistantMessage("CONTINUED");
		},
	]);
	await promptSession(p.sessionId, "Continue the task.");
	expect(input).toContain("Continue the task.");
	expect(input).toContain("archived task");
	const validCommandIncluded = input.includes("bun run valid-interruption");
	faux.setResponses([fauxAssistantMessage("RETRIED")]);
	await promptSession(p.sessionId, "Try again.");
	const receipts = await noticeMessages(p);
	expect(validCommandIncluded).toBe(true);
	expect(receipts).toHaveLength(1);
});

test.each([
	["steering", "user"],
	["followUp", "user"],
	["steering", "control"],
	["followUp", "control"],
	["steering", "removed"],
	["followUp", "removed"],
] as const)("%s queued %s input consumes interruptions only when delivered to the agent", async (mode, kind) => {
	const p = await parent();
	const extensions = join(p.cwd, ".pi", "extensions");
	mkdirSync(extensions, { recursive: true });
	writeFileSync(
		join(extensions, "custom-turn.ts"),
		'export default function(pi) { pi.registerCommand("automatic", { description: "Test automatic turn", handler: async () => { pi.sendMessage({ customType: "test/automatic", content: "AUTOMATIC", display: false }, { triggerTurn: true }); } }); }',
	);
	await reloadSessionResources(p.sessionId);
	command(p, "queued-user-interruption");
	const entered = Promise.withResolvers<void>();
	const release = Promise.withResolvers<void>();
	let input = "";
	let automaticHadNotice = false;
	const callsBefore = faux.state.callCount;
	const text =
		kind === "control"
			? "[thinkrail:todo-nudge] Continue internally."
			: "USER ARRIVED WHILE AUTOMATIC WAS STREAMING";
	faux.setResponses([
		async (context) => {
			automaticHadNotice = JSON.stringify(context.messages).includes(
				"bun run queued-user-interruption",
			);
			entered.resolve();
			await release.promise;
			return fauxAssistantMessage("AUTOMATIC RESPONSE");
		},
		(context) => {
			input = JSON.stringify(context.messages);
			return fauxAssistantMessage("USER RESPONSE");
		},
	]);
	await promptSession(p.sessionId, "/automatic");
	await entered.promise;
	try {
		expect(getSessionState(p.sessionId).execution).toBe("running");
		const deliver = mode === "steering" ? promptSession : followUpSession;
		await deliver(p.sessionId, text);
		if (kind === "removed") clearQueueSession(p.sessionId);
	} finally {
		release.resolve();
	}
	const deadline = Date.now() + 5000;
	while (getSessionState(p.sessionId).execution === "running") {
		if (Date.now() > deadline) throw new Error("queued turn did not settle");
		await Bun.sleep(5);
	}
	if (kind === "removed") expect(input).toBe("");
	else expect(input).toContain(text);
	expect(automaticHadNotice).toBe(false);
	expect(faux.state.callCount - callsBefore).toBe(kind === "removed" ? 1 : 2);
	const arrivedWithNotice = input.includes("bun run queued-user-interruption");
	const beforeIdle = (await noticeMessages(p)).length;
	faux.setResponses([fauxAssistantMessage("IDLE USER RESPONSE")]);
	await promptSession(p.sessionId, "NEXT IDLE USER REQUEST");
	const afterIdle = (await noticeMessages(p)).length;
	expect(beforeIdle).toBe(kind === "user" ? 1 : 0);
	expect(afterIdle).toBe(1);
	expect(arrivedWithNotice).toBe(kind === "user");
	await removeSession(p.sessionId);
});
