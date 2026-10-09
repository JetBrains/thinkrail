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
	dispatchSessionMcpCommand,
	disposeAllSessions,
	getSessionCommands,
	getSessionMessages,
	getSessionState,
	promptSession,
	removeSession,
	requestSessionReload,
	setSessionManagerFactory,
	setSessionMcpServerEnabled,
	setSubagentsEnabledResolver,
	settleSessionsForShutdown,
} from "./agentSessionManager";
import { getSessionResources, setSessionResourcesPublisher } from "./chatResources";
import { MCP_CONFIRM_ONCE } from "./mcp";
import {
	listMcpServers,
	readMcpToolOutput,
	reconcileMcpSessions,
	reconnectMcpServer,
	refreshMcpStatus,
	watchUserMcpConfig,
} from "./mcpSessions";
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
const probeMarker = join(root, "probe-starts.log");
const testExtensions = ["other-mcp.ts", "hang-shutdown.ts", "register-mcp.ts"];
let requests: ExtUiRequest[] = [];
let sequence = 0;

function writeMcpConfig(
	env: Record<string, string> = {},
	extra: Record<string, unknown> = {},
	dir = agentDir,
): void {
	writeFileSync(
		join(dir, "mcp.json"),
		JSON.stringify({
			mcpServers: {
				fixture: {
					command: process.execPath,
					args: [fixture],
					env: { MCP_FIXTURE_PID_FILE: pidFile, ...env },
					exposure: "direct",
				},
				...extra,
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
	rmSync(probeMarker, { force: true });
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

test("pi settings that turn builtin:mcp off make MCP read-only with no chat open, honouring project trust", async () => {
	const cwd = mkdtempSync(join(root, "cwd-"));
	const elsewhere = async (trusted: boolean) =>
		(
			await listMcpServers({
				workspaceId: "engine-idle",
				cwd,
				project: trusted ? { piResourceTrust: "granted" } : undefined,
				waitMs: 0,
			})
		).handledElsewhere;
	expect(await elsewhere(true)).toBeUndefined();
	writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ extensions: ["-builtin:mcp"] }));
	expect(await elsewhere(false)).toEqual({ by: "pi settings (-builtin:mcp)" });
	rmSync(join(agentDir, "settings.json"));
	mkdirSync(join(cwd, ".pi"));
	writeFileSync(
		join(cwd, ".pi", "settings.json"),
		JSON.stringify({ extensions: ["-builtin:mcp"] }),
	);
	expect(await elsewhere(false)).toBeUndefined();
	expect(await elsewhere(true)).toEqual({ by: "pi settings (-builtin:mcp)" });
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
	const listed = await listMcpServers({
		workspaceId: p.workspaceId,
		cwd: p.cwd,
		project: undefined,
		waitMs: 500,
	});
	expect(listed.handledElsewhere?.by).toContain("other-mcp.ts");
	expect(listed.statuses).toEqual([]);
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

const notices = () =>
	requests.flatMap((request) => (request.kind === "notify" ? [request.message] : []));

test("status comes from pi's own /mcp report without toasting it, and generations only grow", async () => {
	const p = await chat();
	const first = await refreshMcpStatus(p.sessionId, 5000);
	expect(first?.servers.find((server) => server.name === "fixture")).toMatchObject({
		state: "connected",
		toolCount: 4,
	});
	const second = await refreshMcpStatus(p.sessionId, 5000);
	expect(second?.generation ?? 0).toBeGreaterThan(first?.generation ?? 0);
	expect(notices().some((message) => message.startsWith("fixture:"))).toBe(false);
	const listed = await listMcpServers({
		workspaceId: p.workspaceId,
		cwd: p.cwd,
		project: undefined,
		waitMs: 5000,
	});
	expect(listed.servers.map((server) => [server.name, server.scope, server.transport])).toEqual([
		["fixture", "user", "stdio"],
	]);
	expect(listed.statuses.map((snapshot) => snapshot.sessionId)).toEqual([p.sessionId]);
	expect(listed.handledElsewhere).toBeUndefined();
	await removeSession(p.sessionId);
});

const SLOW_START = { MCP_FIXTURE_INITIALIZE_DELAY_MS: "1500" };

test("a chat reports its servers starting until pi answers, from the moment it opens and again after each reload", async () => {
	writeMcpConfig(SLOW_START);
	const p = await chat();
	const opened = await listMcpServers({
		workspaceId: p.workspaceId,
		cwd: p.cwd,
		project: undefined,
		waitMs: 0,
	});
	expect(opened.statuses.map((snapshot) => snapshot.sessionId)).toEqual([p.sessionId]);
	const starting = opened.statuses[0]?.servers;
	expect(starting?.map((server) => [server.name, server.state])).toEqual([["fixture", "starting"]]);
	expect(starting?.[0]?.updatedAt).toBeGreaterThan(0);
	await waitFor(async () => (await stateOf(p.sessionId, "fixture")) === "connected");
	const connected = await refreshMcpStatus(p.sessionId, 0);

	expect(await requestSessionReload(p.sessionId)).toBe("reloaded");
	const reloaded = await refreshMcpStatus(p.sessionId, 0);
	expect(reloaded?.servers.find((server) => server.name === "fixture")?.state).toBe("starting");
	expect(reloaded?.generation ?? 0).toBeGreaterThan(connected?.generation ?? 0);
	await waitFor(async () => (await stateOf(p.sessionId, "fixture")) === "connected");
	await removeSession(p.sessionId);
}, 20_000);

test("a status capture takes only its own dispatch's notices, so the user's own /mcp prints in the chat once", async () => {
	writeMcpConfig(SLOW_START);
	const p = await chat();
	const typed = promptSession(p.sessionId, "/mcp");
	const captured: string[] = [];
	const dispatched = dispatchSessionMcpCommand(p.sessionId, "", (message) =>
		captured.push(message),
	);
	await Promise.all([typed, dispatched]);
	expect(captured).toHaveLength(1);
	expect(captured[0]).toStartWith("fixture: connected, 4 tools");
	expect(notices().filter((message) => message.startsWith("fixture:"))).toEqual(captured);
	await removeSession(p.sessionId);
}, 15_000);

test("reconnecting keeps pi's notices out of the chat and rejects with pi's failure", async () => {
	const p = await chat();
	await waitFor(async () => (await stateOf(p.sessionId, "fixture")) === "connected");
	requests = [];
	await reconnectMcpServer(p.sessionId, "fixture");
	const refusal = (name: string) =>
		reconnectMcpServer(p.sessionId, name).then(
			() => null,
			(error: Error) => error.message,
		);
	expect(await refusal("nope")).toBe('No MCP server named "nope".');
	expect(await refusal("ghp_abcdefghijklmnop1234")).toBe('No MCP server named "***".');
	expect(notices()).toEqual([]);
	expect(await stateOf(p.sessionId, "fixture")).toBe("connected");
	await removeSession(p.sessionId);
});

test("disabling a server in one chat stops it at the reload and reads as disabled in this chat", async () => {
	const p = await chat();
	const [pid] = await waitFor(() => (pids().length > 0 ? pids() : undefined));
	expect(await setSessionMcpServerEnabled(p.sessionId, "fixture", false)).toBe("reloaded");
	await waitFor(() => !alive(pid as number), 6000);
	const snapshot = await refreshMcpStatus(p.sessionId, 5000);
	expect(snapshot?.servers.find((server) => server.name === "fixture")?.state).toBe(
		"disabled-in-chat",
	);
	expect(await setSessionMcpServerEnabled(p.sessionId, "fixture", false)).toBe("unchanged");
	await removeSession(p.sessionId);
});

test("a server that fails at startup lands in status instead of a toast", async () => {
	writeMcpConfig({}, { broken: { command: join(root, "missing-binary"), exposure: "direct" } });
	const p = await chat();
	const snapshot = await waitFor(async () => {
		const current = await refreshMcpStatus(p.sessionId, 5000);
		return current?.servers.find((server) => server.name === "broken")?.state === "failed"
			? current
			: undefined;
	});
	expect(snapshot).toBeDefined();
	expect(notices().some((message) => message.startsWith("MCP servers need attention"))).toBe(false);
	await removeSession(p.sessionId);
});

const second = { command: process.execPath, args: [fixture], exposure: "direct" };
const stateOf = async (sessionId: string, name: string) =>
	(await refreshMcpStatus(sessionId, 5000))?.servers.find((server) => server.name === name)?.state;

test("only sessions whose effective config changed reload, and the chat resources list the servers", async () => {
	const a = await chat();
	const b = await chat();
	await waitFor(async () => (await stateOf(a.sessionId, "fixture")) === "connected");
	expect(await reconcileMcpSessions([a.sessionId, b.sessionId])).toEqual({});

	mkdirSync(join(a.cwd, ".pi"), { recursive: true });
	writeFileSync(join(a.cwd, ".pi", "mcp.json"), JSON.stringify({ mcpServers: { repo: second } }));
	expect(await reconcileMcpSessions([a.sessionId, b.sessionId])).toEqual({});

	writeMcpConfig({}, { second });
	expect(await reconcileMcpSessions([a.sessionId, b.sessionId])).toEqual({
		[a.sessionId]: "reloaded",
		[b.sessionId]: "reloaded",
	});
	await waitFor(async () => (await stateOf(b.sessionId, "second")) === "connected");
	const resources = await getSessionResources(b.workspaceId, b.sessionId, b.cwd);
	expect(
		resources.mcpServers?.map((server) => [server.name, server.state, server.transport]),
	).toEqual([
		["fixture", "connected", "stdio"],
		["second", "connected", "stdio"],
	]);
	await removeSession(a.sessionId);
	await removeSession(b.sessionId);
});

test("a busy chat shows pending reload for the changed server and takes the change at settlement", async () => {
	const p = await chat();
	await waitFor(async () => (await stateOf(p.sessionId, "fixture")) === "connected");
	faux.setResponses([fauxAssistantMessage("word ".repeat(3000))]);
	const turn = promptSession(p.sessionId, "Talk for a while.");
	await waitFor(() => getSessionState(p.sessionId).execution === "running");
	writeMcpConfig({}, { second });
	expect(await reconcileMcpSessions([p.sessionId])).toEqual({ [p.sessionId]: "deferred" });
	expect(await stateOf(p.sessionId, "second")).toBe("pending-reload");
	await turn;
	await waitFor(async () => (await stateOf(p.sessionId, "second")) === "connected");
	await removeSession(p.sessionId);
});

test("the user-file watcher creates pi's agent dir when it is missing and then picks up the file", async () => {
	const fresh = join(root, "fresh-agent");
	expect(existsSync(fresh)).toBe(false);
	process.env.PI_CODING_AGENT_DIR = fresh;
	const stop = watchUserMcpConfig();
	try {
		expect(existsSync(fresh)).toBe(true);
		const p = await chat();
		writeMcpConfig({}, {}, fresh);
		await waitFor(async () => (await stateOf(p.sessionId, "fixture")) === "connected");
		await removeSession(p.sessionId);
	} finally {
		stop();
		process.env.PI_CODING_AGENT_DIR = agentDir;
	}
});

test("the user-file watcher reloads live chats after an edit outside the app", async () => {
	const stop = watchUserMcpConfig();
	try {
		const p = await chat();
		await waitFor(async () => (await stateOf(p.sessionId, "fixture")) === "connected");
		writeMcpConfig({}, { second });
		await waitFor(async () => (await stateOf(p.sessionId, "second")) === "connected");
		await removeSession(p.sessionId);
	} finally {
		stop();
	}
});

const mcpResources = async (p: Awaited<ReturnType<typeof chat>>) =>
	(await getSessionResources(p.workspaceId, p.sessionId, p.cwd)).mcpServers;

function probeStarts(): string[] {
	return existsSync(probeMarker)
		? readFileSync(probeMarker, "utf8").split("\n").filter(Boolean)
		: [];
}

test("after another extension takes /mcp over in a live chat, config changes reload nothing and its MCP rows are retired", async () => {
	const p = await chat();
	await waitFor(async () => (await stateOf(p.sessionId, "fixture")) === "connected");
	expect((await mcpResources(p))?.map((server) => server.name)).toEqual(["fixture"]);
	const changes: string[] = [];
	setSessionResourcesPublisher(({ sessionId }) => {
		if (sessionId === p.sessionId) changes.push(sessionId);
	});
	try {
		writeExtension("other-mcp.ts", [
			'import { appendFileSync } from "node:fs";',
			"export default function otherMcp(pi) {",
			`  pi.on("session_start", (event) => appendFileSync(${JSON.stringify(probeMarker)}, \`\${event.reason}\\n\`));`,
			'  pi.registerCommand("mcp", { description: "another MCP manager", handler: async () => {} });',
			"}",
		]);
		expect(await requestSessionReload(p.sessionId)).toBe("reloaded");
		expect(mcpCommands(p.sessionId).map((command) => command.description)).toEqual([
			"another MCP manager",
		]);
		expect(await mcpResources(p)).toEqual([]);
		expect(changes).toHaveLength(1);
		const starts = probeStarts().length;
		writeMcpConfig({}, { second });
		expect(await reconcileMcpSessions([p.sessionId])).toEqual({});
		writeMcpConfig({}, { second, third: second });
		expect(await reconcileMcpSessions([p.sessionId])).toEqual({});
		expect(probeStarts()).toHaveLength(starts);
		expect(await refreshMcpStatus(p.sessionId, 500)).toBeNull();
		expect(await mcpResources(p)).toEqual([]);
		expect(changes).toHaveLength(1);
	} finally {
		setSessionResourcesPublisher(() => {});
	}
	await removeSession(p.sessionId);
});

test("servers an extension registers are marked in the chat's resources, keep their transport, and cannot be disabled per chat", async () => {
	writeExtension("register-mcp.ts", [
		"export default function registerMcp(pi) {",
		`  pi.registerMcpServer("ext-stdio", { command: ${JSON.stringify(process.execPath)}, args: [${JSON.stringify(fixture)}], env: { MCP_FIXTURE_PID_FILE: ${JSON.stringify(pidFile)} }, exposure: "direct" });`,
		'  pi.registerMcpServer("ext-http", { url: "http://127.0.0.1:9/mcp", exposure: "direct" });',
		"}",
	]);
	const p = await chat();
	await waitFor(async () => (await stateOf(p.sessionId, "ext-stdio")) === "connected");
	const rows = await waitFor(async () => {
		const current = await mcpResources(p);
		return current?.length === 3 ? current : undefined;
	});
	expect(rows.map((server) => [server.name, server.transport, server.registered ?? false])).toEqual(
		[
			["fixture", "stdio", false],
			["ext-stdio", "stdio", true],
			["ext-http", "http", true],
		],
	);
	const refusal = await setSessionMcpServerEnabled(p.sessionId, "ext-stdio", false).then(
		() => null,
		(error: Error & { code?: string }) => [error.code, error.message],
	);
	expect(refusal).toEqual([
		"MCP_CONFIG_INVALID",
		'"ext-stdio" is registered by an extension; it can\'t be disabled per chat.',
	]);
	expect(await stateOf(p.sessionId, "ext-stdio")).toBe("connected");
	expect(await setSessionMcpServerEnabled(p.sessionId, "fixture", false)).toBe("reloaded");
	await removeSession(p.sessionId);
});

test("disabling a server in a busy chat reads as pending reload right away", async () => {
	const p = await chat();
	await waitFor(async () => (await stateOf(p.sessionId, "fixture")) === "connected");
	faux.setResponses([fauxAssistantMessage("word ".repeat(3000))]);
	const turn = promptSession(p.sessionId, "Talk for a while.");
	await waitFor(() => getSessionState(p.sessionId).execution === "running");
	expect(await setSessionMcpServerEnabled(p.sessionId, "fixture", false)).toBe("deferred");
	expect((await mcpResources(p))?.map((server) => [server.name, server.state])).toEqual([
		["fixture", "pending-reload"],
	]);
	await turn;
	await waitFor(async () => (await stateOf(p.sessionId, "fixture")) === "disabled-in-chat");
	await removeSession(p.sessionId);
});

test("results carry a durable, base64-free summary, and Full output reads only the recorded file", async () => {
	const p = await chat();
	faux.setResponses([
		fauxAssistantMessage(fauxToolCall("mcp__fixture__rich", {}, { id: "rich" })),
		fauxAssistantMessage(fauxToolCall("mcp__fixture__big", {}, { id: "big" })),
		fauxAssistantMessage("DONE"),
	]);
	await promptSession(p.sessionId, "Use rich and big.");
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

	const big = resultOf("big");
	if (big?.role !== "toolResult") throw new Error("missing big result");
	const fullOutputPath = (big.details as { fullOutputPath?: string }).fullOutputPath;
	expect(typeof fullOutputPath).toBe("string");
	const output = await readMcpToolOutput(p.workspaceId, p.sessionId, "big", p.cwd);
	expect(output.available && output.text.length).toBe("line of output\n".length * 20_000);
	expect(await readMcpToolOutput(p.workspaceId, p.sessionId, "rich", p.cwd)).toEqual({
		available: false,
		reason: "unavailable",
	});
	expect(await readMcpToolOutput(p.workspaceId, p.sessionId, "nope", p.cwd)).toEqual({
		available: false,
		reason: "unavailable",
	});
	rmSync(fullOutputPath as string, { force: true });
	expect(await readMcpToolOutput(p.workspaceId, p.sessionId, "big", p.cwd)).toEqual({
		available: false,
		reason: "expired",
	});
	await removeSession(p.sessionId);
});
