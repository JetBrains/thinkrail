import { afterAll, beforeAll, expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { createFauxCore, fauxAssistantMessage } from "@earendil-works/pi-ai/providers/faux";
import { AgentSession, ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent";
import { observeLoggedErrors } from "../log";
import {
	compactSession,
	createSession,
	disposeAllSessions,
	followUpSession,
	getSessionMessages,
	getSessionState,
	promptSession,
	reloadSessionResources,
	removeQueuedSession,
	requestSessionReload,
	sessionReuseStatus,
	setSessionManagerFactory,
	setSessionPublisher,
	settleSessionsForShutdown,
	startInitialSessionPrompt,
} from "./agentSessionManager";
import { configurePiRuntime } from "./piRuntime";

const model = {
	id: "gate",
	name: "gate",
	reasoning: false,
	input: ["text"] as ("text" | "image")[],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 100_000,
	maxTokens: 4096,
};
// Slow enough that a turn stays observably streaming for a while.
const faux = createFauxCore({
	provider: "gate",
	api: "gate",
	models: [model],
	tokensPerSecond: 40,
});
const saved = {
	agent: process.env.PI_CODING_AGENT_DIR,
	data: process.env.THINKRAIL_DATA_DIR,
	offline: process.env.PI_OFFLINE,
};
const root = mkdtempSync(join(tmpdir(), "reload-gate-"));
const agentDir = join(root, "agent");
const marker = join(root, "lifecycle.jsonl");
const latch = join(root, "COMMAND_MAY_FINISH");
const inputHold = join(root, "HOLD_SLOW_INPUT");
const reloadHold = join(root, "HOLD_RELOAD");
let sequence = 0;

beforeAll(async () => {
	process.env.PI_CODING_AGENT_DIR = agentDir;
	process.env.THINKRAIL_DATA_DIR = join(root, "data");
	process.env.PI_OFFLINE = "1";
	mkdirSync(join(agentDir, "extensions"), { recursive: true });
	writeFileSync(
		join(agentDir, "extensions", "gate-probe.ts"),
		[
			'import { appendFileSync, existsSync } from "node:fs";',
			`const marker = ${JSON.stringify(marker)};`,
			`const latch = ${JSON.stringify(latch)};`,
			`const inputHold = ${JSON.stringify(inputHold)};`,
			`const reloadHold = ${JSON.stringify(reloadHold)};`,
			"const held = async (file) => {",
			"  while (existsSync(file)) await new Promise((resolve) => setTimeout(resolve, 10));",
			"};",
			"export default function probe(pi) {",
			'  pi.on("session_shutdown", async (event) => {',
			'    if (event.reason === "reload") await held(reloadHold);',
			"    await new Promise((resolve) => setTimeout(resolve, 40));",
			'    appendFileSync(marker, JSON.stringify({ kind: "shutdown", reason: event.reason }) + "\\n");',
			"  });",
			'  pi.on("input", async (event) => {',
			'    if (event.text.startsWith("slow:")) await held(inputHold);',
			'    if (event.text === "handled:") return { action: "handled" };',
			"  });",
			'  pi.registerCommand("gate-wait", {',
			'    description: "wait for the test latch",',
			"    handler: async () => {",
			"      while (!existsSync(latch)) await new Promise((resolve) => setTimeout(resolve, 10));",
			'      appendFileSync(marker, JSON.stringify({ kind: "command" }) + "\\n");',
			"    },",
			"  });",
			"}",
			"",
		].join("\n"),
	);
	const runtime = await ModelRuntime.create({
		credentials: new InMemoryCredentialStore(),
		modelsPath: null,
		allowModelNetwork: false,
	});
	runtime.registerProvider("gate", {
		api: faux.api,
		apiKey: "test",
		baseUrl: "http://faux.local",
		streamSimple: faux.streamSimple,
		models: [{ ...model, api: faux.api }],
	});
	configurePiRuntime(runtime);
	setSessionManagerFactory((cwd) => SessionManager.inMemory(cwd));
});

afterAll(async () => {
	await settleSessionsForShutdown();
	disposeAllSessions();
	configurePiRuntime(null);
	setSessionManagerFactory((cwd) => SessionManager.create(cwd));
	if (saved.agent === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = saved.agent;
	if (saved.data === undefined) delete process.env.THINKRAIL_DATA_DIR;
	else process.env.THINKRAIL_DATA_DIR = saved.data;
	if (saved.offline === undefined) delete process.env.PI_OFFLINE;
	else process.env.PI_OFFLINE = saved.offline;
	rmSync(root, { recursive: true, force: true });
});

function events(): { kind: string; reason?: string }[] {
	try {
		return readFileSync(marker, "utf8")
			.split("\n")
			.filter(Boolean)
			.map((line) => JSON.parse(line) as { kind: string; reason?: string });
	} catch {
		return [];
	}
}
const reloads = () => events().filter((e) => e.kind === "shutdown" && e.reason === "reload").length;

async function waitFor(read: () => boolean, ms = 8000): Promise<void> {
	const until = Date.now() + ms;
	while (!read()) {
		if (Date.now() > until) throw new Error("condition timed out");
		await Bun.sleep(10);
	}
}

async function parent() {
	const workspaceId = `gate-${++sequence}`;
	const cwd = mkdtempSync(join(root, "cwd-"));
	const { sessionId } = await createSession({
		workspaceId,
		cwd,
		model: { ...model, provider: "gate", thinkingLevels: ["off"] },
	});
	return { workspaceId, cwd, sessionId };
}

test("an idle session reloads immediately and extensions see the reload lifecycle", async () => {
	const p = await parent();
	const before = reloads();
	expect(await sessionReuseStatus(p.sessionId, p.workspaceId, p.cwd)).toBe("idle");
	expect(await sessionReuseStatus(p.sessionId, "foreign", p.cwd)).toBe(false);
	expect(await requestSessionReload(p.sessionId)).toBe("reloaded");
	expect(reloads()).toBe(before + 1);
	await reloadSessionResources(p.sessionId);
	expect(reloads()).toBe(before + 2);
});

test("a reload requested while the turn streams is deferred and runs at settlement", async () => {
	const p = await parent();
	const before = reloads();
	faux.setResponses([fauxAssistantMessage("word ".repeat(60))]);
	const turn = promptSession(p.sessionId, "Say many words.");
	await waitFor(() => getSessionState(p.sessionId).execution === "running");
	expect(await sessionReuseStatus(p.sessionId, p.workspaceId, p.cwd)).toBe("busy");
	expect(await requestSessionReload(p.sessionId)).toBe("deferred");
	await expect(reloadSessionResources(p.sessionId)).rejects.toThrow(/busy/);
	expect(reloads()).toBe(before);
	await turn;
	await waitFor(() => reloads() === before + 1);
});

test("a prompt held in preflight (a slash command) defers the reload until it is released", async () => {
	const p = await parent();
	const before = reloads();
	rmSync(latch, { force: true });
	const command = promptSession(p.sessionId, "/gate-wait");
	await Bun.sleep(50);
	expect(getSessionState(p.sessionId).execution).not.toBe("running");
	expect(await sessionReuseStatus(p.sessionId, p.workspaceId, p.cwd)).toBe("busy");
	expect(await requestSessionReload(p.sessionId)).toBe("deferred");
	expect(reloads()).toBe(before);
	writeFileSync(latch, "");
	await command;
	await waitFor(() => reloads() === before + 1);
	expect(events().some((e) => e.kind === "command")).toBe(true);
});

function userTexts(messages: Awaited<ReturnType<typeof getSessionMessages>>["messages"]): string[] {
	return messages.flatMap((message) =>
		message.role === "user"
			? [
					typeof message.content === "string"
						? message.content
						: message.content.map((block) => (block.type === "text" ? block.text : "")).join(""),
				]
			: [],
	);
}

test("removing a queued message keeps the others when the run settles with a reload pending meanwhile", async () => {
	const p = await parent();
	const before = reloads();
	faux.setResponses([
		fauxAssistantMessage("word ".repeat(60)),
		fauxAssistantMessage("kept two"),
		fauxAssistantMessage("kept one"),
	]);
	const turn = promptSession(p.sessionId, "Say many words.");
	await waitFor(() => getSessionState(p.sessionId).execution === "running");
	await followUpSession(p.sessionId, "slow: keep one");
	await followUpSession(p.sessionId, "drop me");
	await followUpSession(p.sessionId, "keep two");
	expect(await requestSessionReload(p.sessionId)).toBe("deferred");
	writeFileSync(inputHold, "");
	writeFileSync(reloadHold, "");
	try {
		const removal = removeQueuedSession(p.sessionId, "followUp", 1);
		await expect(
			startInitialSessionPrompt(p.sessionId, "cannot enter during removal"),
		).rejects.toThrow(/busy|admitted/);
		await turn;
		await Bun.sleep(100);
		rmSync(inputHold, { force: true });
		expect((await removal).removed).toEqual({ text: "drop me" });
		expect(reloads()).toBe(before);
	} finally {
		rmSync(inputHold, { force: true });
		rmSync(reloadHold, { force: true });
	}
	await waitFor(() => reloads() === before + 1);
	const { messages } = await getSessionMessages(p.sessionId, p.workspaceId, p.cwd);
	const texts = userTexts(messages);
	expect(texts).toContain("slow: keep one");
	expect(texts).toContain("keep two");
	expect(texts).not.toContain("drop me");
});

test("nothing is admitted while a reload runs", async () => {
	const p = await parent();
	const reload = requestSessionReload(p.sessionId);
	expect(await sessionReuseStatus(p.sessionId, p.workspaceId, p.cwd)).toBe("busy");
	await expect(promptSession(p.sessionId, "hello")).rejects.toThrow(/reloading/);
	await reload;
	faux.setResponses([fauxAssistantMessage("ok")]);
	await promptSession(p.sessionId, "hello");
});

test("initial admission acknowledges native preflight, not elapsed time or the whole model turn", async () => {
	const p = await parent();
	faux.setResponses([fauxAssistantMessage("word ".repeat(60))]);
	writeFileSync(inputHold, "");
	let accepted = false;
	const admission = startInitialSessionPrompt(p.sessionId, "slow: initial").then(() => {
		accepted = true;
	});
	try {
		await Bun.sleep(80);
		expect(accepted).toBe(false);
		await expect(startInitialSessionPrompt(p.sessionId, "duplicate")).rejects.toThrow(
			/admitted|busy/,
		);
		await expect(reloadSessionResources(p.sessionId)).rejects.toThrow(/admitted|busy/);
	} finally {
		rmSync(inputHold, { force: true });
	}
	await admission;
	expect(accepted).toBe(true);
	expect(getSessionState(p.sessionId).execution).toBe("running");
	await expect(startInitialSessionPrompt(p.sessionId, "must not steer")).rejects.toThrow(/busy/);
	expect(getSessionState(p.sessionId).queuedCount).toBe(0);
	await waitFor(() => getSessionState(p.sessionId).execution !== "running");
	const { messages } = await getSessionMessages(p.sessionId, p.workspaceId, p.cwd);
	expect(userTexts(messages)).toEqual(["slow: initial"]);
});

test("initial admission rejects reload, compaction, unknown sessions and invalid text", async () => {
	const p = await parent();
	await expect(startInitialSessionPrompt("missing", "hello")).rejects.toThrow(/Unknown session/);
	for (const text of ["", " \n", "a".repeat(131073), "\u{1f600}".repeat(32769)]) {
		await expect(startInitialSessionPrompt(p.sessionId, text)).rejects.toThrow(/text|prompt/i);
	}
	const reload = requestSessionReload(p.sessionId);
	await expect(startInitialSessionPrompt(p.sessionId, "hello")).rejects.toThrow(/reloading/);
	await reload;
	let finish!: () => void;
	const compact = spyOn(AgentSession.prototype, "compact").mockImplementation(
		() =>
			new Promise((resolve) => {
				finish = () => resolve({} as never);
			}),
	);
	try {
		const compaction = compactSession(p.sessionId);
		await expect(startInitialSessionPrompt(p.sessionId, "hello")).rejects.toThrow(/compaction/);
		finish();
		await compaction;
	} finally {
		compact.mockRestore();
	}
});

test("initial admission rejects handled input and a command rather than claiming a model start", async () => {
	const p = await parent();
	await expect(startInitialSessionPrompt(p.sessionId, "handled:")).rejects.toThrow(
		/not started|not accepted/i,
	);
	writeFileSync(latch, "");
	await expect(startInitialSessionPrompt(p.sessionId, "/gate-wait")).rejects.toThrow(
		/not started|not accepted/i,
	);
	expect(await sessionReuseStatus(p.sessionId, p.workspaceId, p.cwd)).toBe("idle");
});

test("initial admission propagates pre-ack failures and refuses missing or queued acknowledgement", async () => {
	const p = await parent();
	const failure = new Error("preflight failed");
	const prompt = spyOn(AgentSession.prototype, "prompt");
	try {
		prompt.mockImplementationOnce(async () => {
			throw failure;
		});
		await expect(startInitialSessionPrompt(p.sessionId, "hello")).rejects.toBe(failure);
		prompt.mockImplementationOnce(async () => {});
		await expect(startInitialSessionPrompt(p.sessionId, "hello")).rejects.toThrow(
			/not started|not accepted/i,
		);
		prompt.mockImplementationOnce(async (_text, options) => {
			options?.preflightResult?.("queued");
		});
		await expect(startInitialSessionPrompt(p.sessionId, "hello")).rejects.toThrow(
			/not started|not accepted/i,
		);
		expect(await sessionReuseStatus(p.sessionId, p.workspaceId, p.cwd)).toBe("idle");
	} finally {
		prompt.mockRestore();
	}
});

test("initial prompt provider errors settle through the normal session event stream", async () => {
	const p = await parent();
	const events: string[] = [];
	let terminal: unknown;
	setSessionPublisher((payload) => {
		if (payload.sessionId !== p.sessionId) return;
		events.push(payload.event.type);
		if (payload.event.type === "agent_settled") terminal = payload.event.terminal;
	});
	try {
		faux.setResponses([
			fauxAssistantMessage("", { stopReason: "error", errorMessage: "initial provider failed" }),
		]);
		await startInitialSessionPrompt(p.sessionId, "hello");
		await waitFor(() => events.includes("agent_settled"));
		expect(events).toContain("agent_start");
		expect(events).toContain("agent_end");
		expect(terminal).toEqual({ stopReason: "error", errorMessage: "initial provider failed" });
		expect(getSessionState(p.sessionId).execution).not.toBe("running");
		expect(await sessionReuseStatus(p.sessionId, p.workspaceId, p.cwd)).toBe("idle");
	} finally {
		setSessionPublisher(() => {});
	}
});

test("initial admission rejects native credential preflight failure and releases its reservation", async () => {
	const p = await parent();
	const configured = spyOn(ModelRuntime.prototype, "hasConfiguredAuth").mockReturnValue(false);
	const check = spyOn(ModelRuntime.prototype, "checkAuth").mockResolvedValue(undefined);
	try {
		await expect(startInitialSessionPrompt(p.sessionId, "hello")).rejects.toThrow(
			/API key|Authentication/,
		);
		expect(await sessionReuseStatus(p.sessionId, p.workspaceId, p.cwd)).toBe("idle");
	} finally {
		configured.mockRestore();
		check.mockRestore();
	}
});

test("initial acknowledgement does not release admission early; late rejection is consumed and logged", async () => {
	const p = await parent();
	const failure = new Error("failure after acknowledgement");
	const observed: { scope: string; error: unknown }[] = [];
	let fail!: (error: Error) => void;
	const prompt = spyOn(AgentSession.prototype, "prompt").mockImplementation((_text, options) => {
		options?.preflightResult?.("started");
		return new Promise((_resolve, reject) => {
			fail = reject;
		});
	});
	observeLoggedErrors((scope, error) => observed.push({ scope, error }));
	try {
		await startInitialSessionPrompt(p.sessionId, "hello");
		await expect(startInitialSessionPrompt(p.sessionId, "second")).rejects.toThrow(/admitted/);
		await expect(reloadSessionResources(p.sessionId)).rejects.toThrow(/admitted/);
		fail(failure);
		await waitFor(() => observed.some((entry) => entry.error === failure));
		expect(observed).toContainEqual({ scope: "agent", error: failure });
		expect(await sessionReuseStatus(p.sessionId, p.workspaceId, p.cwd)).toBe("idle");
		expect(prompt).toHaveBeenCalledTimes(1);
	} finally {
		prompt.mockRestore();
		observeLoggedErrors(null);
	}
});

test("initial admission rejects a closing session", async () => {
	const p = await parent();
	const shutdown = settleSessionsForShutdown();
	await expect(startInitialSessionPrompt(p.sessionId, "hello")).rejects.toThrow(/closing/);
	await shutdown;
});
