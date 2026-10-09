import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import {
	createFauxCore,
	fauxAssistantMessage,
	fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux";
import { AgentSession, ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent";
import type { ExtUiRequest } from "@thinkrail/contracts";
import {
	createSession,
	disposeAllSessions,
	getSessionCommands,
	getSessionMessages,
	promptSession,
	removeSession,
	setSessionManagerFactory,
	setSubagentsEnabledResolver,
	settleSessionsForShutdown,
} from "./agentSessionManager";
import { MCP_CONFIRM_ONCE } from "./mcp";
import { configurePiRuntime } from "./piRuntime";
import { resolveExtUi, setExtUiPublisher } from "./webUiContext";

const model = {
	id: "engine",
	name: "engine",
	reasoning: false,
	input: ["text"] as ("text" | "image")[],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 100_000,
	maxTokens: 4096,
};
const faux = createFauxCore({
	provider: "engine",
	api: "engine",
	models: [model],
	tokensPerSecond: 4000,
});
const saved = {
	agent: process.env.PI_CODING_AGENT_DIR,
	data: process.env.THINKRAIL_DATA_DIR,
	offline: process.env.PI_OFFLINE,
};
const root = mkdtempSync(join(tmpdir(), "mcp-engine-"));
const agentDir = join(root, "agent");
const pidFile = join(root, "fixture.pids");
const fixture = join(import.meta.dir, "mcp", "fixtures", "stdioServer.ts");
const testExtensions = ["other-mcp.ts", "hang-shutdown.ts"];
let requests: ExtUiRequest[] = [];
let sequence = 0;

function writeMcpConfig(env: Record<string, string> = {}): void {
	writeFileSync(
		join(agentDir, "mcp.json"),
		JSON.stringify({
			mcpServers: {
				fixture: {
					command: process.execPath,
					args: [fixture],
					env: { MCP_FIXTURE_PID_FILE: pidFile, ...env },
					exposure: "direct",
				},
			},
		}),
	);
}

beforeAll(async () => {
	setSubagentsEnabledResolver(() => true);
	process.env.PI_CODING_AGENT_DIR = agentDir;
	process.env.THINKRAIL_DATA_DIR = join(root, "data");
	process.env.PI_OFFLINE = "1";
	mkdirSync(join(agentDir, "extensions"), { recursive: true });
	const runtime = await ModelRuntime.create({
		credentials: new InMemoryCredentialStore(),
		modelsPath: null,
		allowModelNetwork: false,
	});
	runtime.registerProvider("engine", {
		api: faux.api,
		apiKey: "test",
		baseUrl: "http://faux.local",
		streamSimple: faux.streamSimple,
		models: [{ ...model, api: faux.api }],
	});
	configurePiRuntime(runtime);
	setSessionManagerFactory((cwd) => SessionManager.inMemory(cwd));
	setExtUiPublisher((request) => requests.push(request));
});

function killFixtures(): void {
	for (const pid of pids()) {
		try {
			process.kill(pid, "SIGKILL");
		} catch {}
	}
}

beforeEach(() => {
	requests = [];
	killFixtures();
	rmSync(pidFile, { force: true });
	rmSync(join(agentDir, "settings.json"), { force: true });
	for (const name of testExtensions) rmSync(join(agentDir, "extensions", name), { force: true });
	writeMcpConfig();
});

function writeExtension(name: string, lines: string[]): void {
	writeFileSync(join(agentDir, "extensions", name), [...lines, ""].join("\n"));
}

function writeHangingShutdownExtension(): void {
	writeExtension("hang-shutdown.ts", [
		"export default function hangShutdown(pi) {",
		'  pi.on("session_shutdown", (event) => (event.reason === "quit" ? new Promise(() => {}) : undefined));',
		"}",
	]);
}

afterAll(async () => {
	setExtUiPublisher(() => {});
	await settleSessionsForShutdown();
	disposeAllSessions();
	configurePiRuntime(null);
	setSessionManagerFactory((cwd) => SessionManager.create(cwd));
	killFixtures();
	if (saved.agent === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = saved.agent;
	if (saved.data === undefined) delete process.env.THINKRAIL_DATA_DIR;
	else process.env.THINKRAIL_DATA_DIR = saved.data;
	if (saved.offline === undefined) delete process.env.PI_OFFLINE;
	else process.env.PI_OFFLINE = saved.offline;
	rmSync(root, { recursive: true, force: true });
});

function pids(): number[] {
	if (!existsSync(pidFile)) return [];
	return readFileSync(pidFile, "utf8").split("\n").filter(Boolean).map(Number);
}

function alive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

async function waitFor<T>(
	read: () => T | undefined | false | Promise<T | undefined | false>,
	ms = 8000,
): Promise<T> {
	const until = Date.now() + ms;
	for (;;) {
		const value = await read();
		if (value !== undefined && value !== false) return value;
		if (Date.now() > until) throw new Error("condition timed out");
		await Bun.sleep(10);
	}
}

async function chat() {
	const workspaceId = `engine-${++sequence}`;
	const cwd = mkdtempSync(join(root, "cwd-"));
	const { sessionId } = await createSession({ workspaceId, cwd });
	return { workspaceId, cwd, sessionId };
}

async function toolTexts(p: Awaited<ReturnType<typeof chat>>): Promise<string[]> {
	const { messages } = await getSessionMessages(p.sessionId, p.workspaceId, p.cwd);
	return messages.flatMap((message) =>
		message.role === "toolResult"
			? [message.content.map((block) => (block.type === "text" ? block.text : "")).join("")]
			: [],
	);
}

const mcpCommands = (sessionId: string) =>
	getSessionCommands(sessionId).filter((command) => command.name === "mcp");

test("a user-level server connects in a chat, its tools are callable, and a write tool asks first", async () => {
	const p = await chat();
	faux.setResponses([
		fauxAssistantMessage(fauxToolCall("mcp__fixture__echo", { text: "hi" }, { id: "echo" })),
		fauxAssistantMessage(fauxToolCall("mcp__fixture__write_note", { text: "x" }, { id: "write" })),
		fauxAssistantMessage("DONE"),
	]);
	const turn = promptSession(p.sessionId, "Use the fixture.");
	const asked = await waitFor(() => requests.find((request) => request.kind === "select"));
	resolveExtUi({ id: asked.id, value: MCP_CONFIRM_ONCE });
	await turn;
	expect(await toolTexts(p)).toEqual(["echo: hi", "write_note: x"]);
	expect(mcpCommands(p.sessionId)).toHaveLength(1);
	await removeSession(p.sessionId);
});

test("deleting a chat terminates its stdio server, even one that ignores EOF and SIGTERM", async () => {
	writeMcpConfig({ MCP_FIXTURE_STUBBORN: "1" });
	const p = await chat();
	const [pid] = await waitFor(() => (pids().length > 0 ? pids() : undefined));
	expect(alive(pid as number)).toBe(true);
	await removeSession(p.sessionId);
	await waitFor(() => !alive(pid as number), 6000);
});

test("quitting terminates the servers of every live chat", async () => {
	await chat();
	const [pid] = await waitFor(() => (pids().length > 0 ? pids() : undefined));
	await settleSessionsForShutdown();
	disposeAllSessions();
	await waitFor(() => !alive(pid as number), 6000);
});

const SHUTDOWN_DEADLINE_MS = 3500;
const untilDeadline = (started: number) => Math.max(0, started + SHUTDOWN_DEADLINE_MS - Date.now());

test("deleting a chat stops pi's MCP servers within the budget even when another extension's shutdown never settles", async () => {
	writeHangingShutdownExtension();
	writeMcpConfig({ MCP_FIXTURE_STUBBORN: "1" });
	const p = await chat();
	const [pid] = await waitFor(() => (pids().length > 0 ? pids() : undefined));
	const started = Date.now();
	await removeSession(p.sessionId);
	await waitFor(() => !alive(pid as number), untilDeadline(started));
}, 15_000);

test("quitting stops pi's MCP servers within the budget even when another extension's shutdown never settles", async () => {
	writeHangingShutdownExtension();
	writeMcpConfig({ MCP_FIXTURE_STUBBORN: "1" });
	await chat();
	const [pid] = await waitFor(() => (pids().length > 0 ? pids() : undefined));
	const started = Date.now();
	await settleSessionsForShutdown();
	disposeAllSessions();
	await waitFor(() => !alive(pid as number), untilDeadline(started));
}, 15_000);

test("a chat whose preparation fails after pi started its servers still stops them", async () => {
	writeMcpConfig({ MCP_FIXTURE_STUBBORN: "1" });
	const originalBind = AgentSession.prototype.bindExtensions;
	let binding: AgentSession | undefined;
	let releaseRegistration = () => {};
	const registration = new Promise<void>((resolve) => {
		releaseRegistration = resolve;
	});
	AgentSession.prototype.bindExtensions = async function (bindings) {
		await originalBind.call(this, bindings);
		binding = this;
		await registration;
	};
	try {
		const creating = chat();
		const failed = creating.then(
			() => "registered",
			(error: Error) => error.message,
		);
		await waitFor(() =>
			binding?.extensionRunner
				.getAllRegisteredTools()
				.some((tool) => tool.definition.name.startsWith("mcp__fixture__")),
		);
		const [pid] = pids();
		disposeAllSessions();
		const started = Date.now();
		releaseRegistration();
		expect(await failed).toContain("Workspace is unavailable");
		await waitFor(() => !alive(pid as number), untilDeadline(started));
	} finally {
		releaseRegistration();
		AgentSession.prototype.bindExtensions = originalBind;
	}
}, 15_000);

test("-builtin:mcp in pi settings keeps the engine out and starts no server", async () => {
	writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ extensions: ["-builtin:mcp"] }));
	const p = await chat();
	await Bun.sleep(300);
	expect(mcpCommands(p.sessionId)).toHaveLength(0);
	expect(pids()).toEqual([]);
	await removeSession(p.sessionId);
});

test("an installed extension that owns /mcp replaces the built-in instead of running alongside it", async () => {
	writeFileSync(
		join(agentDir, "extensions", "other-mcp.ts"),
		[
			"export default function otherMcp(pi) {",
			'  pi.registerCommand("mcp", { description: "another MCP manager", handler: async () => {} });',
			"}",
			"",
		].join("\n"),
	);
	const p = await chat();
	await Bun.sleep(300);
	expect(mcpCommands(p.sessionId).map((command) => command.description)).toEqual([
		"another MCP manager",
	]);
	expect(pids()).toEqual([]);
	expect(mcpCommands(p.sessionId)[0]?.sourceInfo.path).toContain("other-mcp.ts");
	await removeSession(p.sessionId);
});

test("a subagent run starts no MCP server of its own", async () => {
	const p = await chat();
	await waitFor(() => (pids().length > 0 ? pids() : undefined));
	faux.setResponses([
		fauxAssistantMessage(
			fauxToolCall("Agent", { subagent_type: "scout", task: "Look around." }, { id: "agent" }),
		),
		fauxAssistantMessage("CHILD_REPORT"),
		fauxAssistantMessage("DONE"),
	]);
	await promptSession(p.sessionId, "Delegate.");
	expect((await toolTexts(p)).join("\n")).toContain("CHILD_REPORT");
	expect(pids()).toHaveLength(1);
	await removeSession(p.sessionId);
});

test("results carry a durable, base64-free summary", async () => {
	const p = await chat();
	faux.setResponses([
		fauxAssistantMessage(fauxToolCall("mcp__fixture__rich", {}, { id: "rich" })),
		fauxAssistantMessage("DONE"),
	]);
	await promptSession(p.sessionId, "Use rich.");
	const { messages } = await getSessionMessages(p.sessionId, p.workspaceId, p.cwd);
	const resultOf = (toolCallId: string) =>
		messages.find((message) => message.role === "toolResult" && message.toolCallId === toolCallId);
	const rich = resultOf("rich");
	if (rich?.role !== "toolResult") throw new Error("missing rich result");
	expect((rich.details as { thinkrail?: unknown }).thinkrail).toEqual({
		blocks: [
			{ kind: "text", chars: 11 },
			{ kind: "image", mimeType: "image/png" },
			{ kind: "resource_link", uri: "file:///notes/a.md", name: "a.md", mimeType: "text/markdown" },
		],
		structuredContent: { rows: [{ id: 1, title: "first" }] },
	});
	expect(JSON.stringify(rich.details)).not.toContain("iVBORw0KGgo");
	await removeSession(p.sessionId);
});
