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
	applyPiResourceTrust,
	createSession,
	deleteSession,
	disposeAllSessions,
	getSessionCommands,
	getSessionMessages,
	promptSession,
	removeSession,
	removeWorkspaceSessions,
	requestSessionReload,
	setSessionManagerFactory,
	setSkillAdmissionResolver,
	setSubagentsEnabledResolver,
	settleSessionsForShutdown,
} from "./agentSessionManager";
import { MCP_CONFIRM_ONCE } from "./mcp";
import { configurePiRuntime } from "./piRuntime";
import { admissionContextFor } from "./skillAdmission";
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
const testExtensions = [
	"other-mcp.ts",
	"hang-shutdown.ts",
	"hang-reload.ts",
	"reload-pause.ts",
	"closing-probe.ts",
];
let requests: ExtUiRequest[] = [];
let sequence = 0;

function writeMcpConfig(
	env: Record<string, string> = {},
	extra: Record<string, unknown> = {},
): void {
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
	rmSync(probeMarker, { force: true });
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
	const { sessionId } = await createSession({
		workspaceId,
		cwd,
		model: { ...faux.getModel(), thinkingLevels: ["off"] },
	});
	return { workspaceId, cwd, sessionId };
}

async function connected(sessionId: string): Promise<void> {
	const from = requests.length;
	await promptSession(sessionId, "/mcp");
	expect(
		requests
			.slice(from)
			.some(
				(request) =>
					request.sessionId === sessionId &&
					request.kind === "notify" &&
					request.message.startsWith("fixture: connected"),
			),
	).toBe(true);
}

function probeStarts(): string[] {
	return existsSync(probeMarker)
		? readFileSync(probeMarker, "utf8").split("\n").filter(Boolean)
		: [];
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

test("a reload finishes stubborn MCP cleanup before the replacement process starts", async () => {
	writeMcpConfig({ MCP_FIXTURE_STUBBORN: "1" });
	const p = await chat();
	try {
		await connected(p.sessionId);
		const [oldPid] = pids();
		const replacement = join(p.cwd, "replacement.ts");
		writeFileSync(
			replacement,
			[
				'import { appendFileSync } from "node:fs";',
				"let alive = false;",
				`try { process.kill(${oldPid}, 0); alive = true; } catch {}`,
				`appendFileSync(${JSON.stringify(probeMarker)}, alive ? "old-alive\\n" : "old-dead\\n");`,
				`await import(${JSON.stringify(fixture)});`,
			].join("\n"),
		);
		writeMcpConfig(
			{},
			{
				fixture: {
					command: process.execPath,
					args: [replacement],
					env: { MCP_FIXTURE_PID_FILE: pidFile },
					exposure: "direct",
				},
			},
		);
		expect(await requestSessionReload(p.sessionId)).toBe("reloaded");
		await connected(p.sessionId);
		expect(probeStarts()).toEqual(["old-dead"]);
		expect(pids()).toHaveLength(2);
		expect(alive(oldPid as number)).toBe(false);
		expect(alive(pids()[1] as number)).toBe(true);
	} finally {
		await removeSession(p.sessionId);
	}
}, 15_000);

test("runner-emitted shutdown joins the captured MCP cleanup instead of observing an empty server list", async () => {
	writeMcpConfig({ MCP_FIXTURE_STUBBORN: "1" });
	const originalBind = AgentSession.prototype.bindExtensions;
	let binding: AgentSession | undefined;
	AgentSession.prototype.bindExtensions = async function (bindings) {
		binding = this;
		await originalBind.call(this, bindings);
	};
	try {
		const p = await chat();
		await connected(p.sessionId);
		if (!binding) throw new Error("Missing pi session");
		const runner = binding.extensionRunner;
		const [pid] = pids();
		const closing = removeSession(p.sessionId);
		await runner.emit({ type: "session_shutdown", reason: "quit" });
		expect(alive(pid as number)).toBe(false);
		await closing;
	} finally {
		AgentSession.prototype.bindExtensions = originalBind;
		disposeAllSessions();
	}
}, 15_000);

for (const reason of ["resource", "trust"] as const) {
	test(`a ${reason} reload stops MCP within budget even when an earlier extension's shutdown hangs`, async () => {
		writeExtension("hang-reload.ts", [
			'import { appendFileSync } from "node:fs";',
			"export default function hangReload(pi) {",
			'  pi.on("session_shutdown", (event) => {',
			'    if (event.reason !== "reload") return;',
			`    appendFileSync(${JSON.stringify(probeMarker)}, "reload\\n");`,
			"    return new Promise(() => {});",
			"  });",
			"}",
		]);
		writeMcpConfig({ MCP_FIXTURE_STUBBORN: "1" });
		setSkillAdmissionResolver(() => admissionContextFor({ piResourceTrust: "granted" }));
		const p = await chat();
		try {
			await connected(p.sessionId);
			const [pid] = pids();
			setSkillAdmissionResolver(() => admissionContextFor(undefined));
			let settled = false;
			const started = Date.now();
			const reloading =
				reason === "resource"
					? requestSessionReload(p.sessionId)
					: applyPiResourceTrust([p.workspaceId]);
			void reloading.then(
				() => {
					settled = true;
				},
				() => {
					settled = true;
				},
			);
			await waitFor(() => probeStarts().includes("reload"));
			await expect(promptSession(p.sessionId, "Stay quiescent.")).rejects.toThrow(/reloading/);
			await waitFor(() => !alive(pid as number), untilDeadline(started));
			expect(settled).toBe(false);
			expect(pids()).toHaveLength(1);
		} finally {
			setSkillAdmissionResolver(() => admissionContextFor(undefined));
			await removeSession(p.sessionId);
		}
	}, 15_000);
}

const closures = [
	["removing the chat", (p: Awaited<ReturnType<typeof chat>>) => removeSession(p.sessionId)],
	[
		"deleting the chat",
		(p: Awaited<ReturnType<typeof chat>>) => deleteSession(p.sessionId, p.workspaceId, p.cwd),
	],
	[
		"removing the workspace",
		(p: Awaited<ReturnType<typeof chat>>) => removeWorkspaceSessions(p.workspaceId, p.cwd),
	],
	["polite host shutdown", () => settleSessionsForShutdown()],
	["emergency host disposal", () => disposeAllSessions()],
] as const;

for (const [label, close] of closures) {
	test(`${label} during a pending resource load prevents MCP restart and cleans up the new runner`, async () => {
		const p = await chat();
		await connected(p.sessionId);
		const before = pids();
		const entered = join(p.cwd, "reload-entered");
		const released = join(p.cwd, "reload-released");
		writeExtension("reload-pause.ts", [
			'import { appendFileSync, existsSync, writeFileSync } from "node:fs";',
			"export default async function pause(pi) {",
			`  writeFileSync(${JSON.stringify(entered)}, "");`,
			`  while (!existsSync(${JSON.stringify(released)})) await new Promise(resolve => setTimeout(resolve, 10));`,
			`  pi.on("session_start", () => appendFileSync(${JSON.stringify(probeMarker)}, "started\\n"));`,
			'  pi.on("session_shutdown", async () => {',
			"    await new Promise(resolve => setTimeout(resolve, 50));",
			'    pi.getFlag("probe");',
			`    appendFileSync(${JSON.stringify(probeMarker)}, "shutdown\\n");`,
			"  });",
			"}",
		]);
		const reloading = requestSessionReload(p.sessionId).then(
			() => "reloaded",
			(error: Error) => error.message,
		);
		try {
			await waitFor(() => existsSync(entered));
			const started = Date.now();
			await close(p);
			expect(Date.now() - started).toBeLessThan(SHUTDOWN_DEADLINE_MS);
			await waitFor(() => before.every((pid) => !alive(pid)));
			writeFileSync(released, "");
			expect(await reloading).toBe("The chat is closing.");
			expect(probeStarts()).toEqual(["shutdown"]);
			await Bun.sleep(100);
			expect(pids()).toEqual(before);
		} finally {
			writeFileSync(released, "");
			await reloading;
			disposeAllSessions();
		}
	}, 15_000);
}

for (const [label, close] of closures) {
	test(`${label} during a paused session_start prevents late MCP startup after shutdown`, async () => {
		const p = await chat();
		await connected(p.sessionId);
		const before = pids();
		const entered = join(p.cwd, "start-entered");
		const released = join(p.cwd, "start-released");
		writeExtension("reload-pause.ts", [
			'import { appendFileSync, existsSync, writeFileSync } from "node:fs";',
			"export default function pause(pi) {",
			'  pi.on("session_start", async () => {',
			`    writeFileSync(${JSON.stringify(entered)}, "");`,
			`    while (!existsSync(${JSON.stringify(released)})) await new Promise(resolve => setTimeout(resolve, 10));`,
			`    appendFileSync(${JSON.stringify(probeMarker)}, "resumed\\n");`,
			"  });",
			'  pi.on("session_shutdown", () => {',
			`    appendFileSync(${JSON.stringify(probeMarker)}, "shutdown\\n");`,
			"  });",
			'  pi.on("resources_discover", async () => {',
			"    await new Promise(resolve => setTimeout(resolve, 100));",
			`    appendFileSync(${JSON.stringify(probeMarker)}, "discovered\\n");`,
			"  });",
			"}",
		]);
		const reloading = requestSessionReload(p.sessionId).then(
			() => "reloaded",
			(error: Error) => error.message,
		);
		try {
			await waitFor(() => existsSync(entered));
			const started = Date.now();
			await close(p);
			expect(Date.now() - started).toBeLessThan(SHUTDOWN_DEADLINE_MS);
			await waitFor(() => probeStarts().includes("shutdown"));
			expect(before.every((pid) => !alive(pid))).toBe(true);
			writeFileSync(released, "");
			const outcome = await reloading;
			expect(probeStarts()).toEqual(["shutdown", "resumed", "discovered"]);
			await Bun.sleep(100);
			expect(pids()).toEqual(before);
			expect(outcome).toBe("The chat is closing.");
			disposeAllSessions();
			await Bun.sleep(100);
			expect(pids()).toEqual(before);
		} finally {
			writeFileSync(released, "");
			await reloading;
			disposeAllSessions();
		}
	}, 15_000);
}

test("emergency disposal during graceful closure waits for the replacement runner's own shutdown", async () => {
	const oldEntered = join(root, "old-shutdown-entered");
	const oldReleased = join(root, "old-shutdown-released");
	const loadEntered = join(root, "overlap-load-entered");
	const loadReleased = join(root, "overlap-load-released");
	const newEntered = join(root, "new-shutdown-entered");
	const newReleased = join(root, "new-shutdown-released");
	writeExtension("closing-probe.ts", [
		'import { existsSync, writeFileSync } from "node:fs";',
		"export default function closing(pi) {",
		'  pi.on("session_shutdown", async (event) => {',
		'    if (event.reason !== "quit") return;',
		`    writeFileSync(${JSON.stringify(oldEntered)}, "");`,
		`    while (!existsSync(${JSON.stringify(oldReleased)})) await new Promise(resolve => setTimeout(resolve, 10));`,
		"  });",
		"}",
	]);
	const p = await chat();
	await connected(p.sessionId);
	const before = pids();
	rmSync(join(agentDir, "extensions", "closing-probe.ts"));
	writeExtension("reload-pause.ts", [
		'import { appendFileSync, existsSync, writeFileSync } from "node:fs";',
		"export default async function pause(pi) {",
		`  writeFileSync(${JSON.stringify(loadEntered)}, "");`,
		`  while (!existsSync(${JSON.stringify(loadReleased)})) await new Promise(resolve => setTimeout(resolve, 10));`,
		`  pi.on("session_start", () => appendFileSync(${JSON.stringify(probeMarker)}, "started\\n"));`,
		'  pi.on("session_shutdown", async () => {',
		`    writeFileSync(${JSON.stringify(newEntered)}, "");`,
		`    while (!existsSync(${JSON.stringify(newReleased)})) await new Promise(resolve => setTimeout(resolve, 10));`,
		'    pi.getFlag("probe");',
		`    appendFileSync(${JSON.stringify(probeMarker)}, "shutdown\\n");`,
		"  });",
		"}",
	]);
	const reloading = requestSessionReload(p.sessionId).then(
		() => "reloaded",
		(error: Error) => error.message,
	);
	let closing: Promise<void> | undefined;
	try {
		await waitFor(() => existsSync(loadEntered));
		closing = settleSessionsForShutdown();
		await waitFor(() => existsSync(oldEntered));
		writeFileSync(loadReleased, "");
		await waitFor(() => existsSync(newEntered));
		disposeAllSessions();
		writeFileSync(oldReleased, "");
		await closing;
		writeFileSync(newReleased, "");
		expect(await reloading).toBe("The chat is closing.");
		expect(probeStarts()).toEqual(["shutdown"]);
		expect(pids()).toEqual(before);
		expect(before.every((pid) => !alive(pid))).toBe(true);
	} finally {
		for (const file of [oldReleased, loadReleased, newReleased]) writeFileSync(file, "");
		await reloading;
		await closing;
		disposeAllSessions();
	}
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
			fauxToolCall(
				"Agent",
				{ subagent_type: "scout", task: "Look around.", model: "engine/engine" },
				{ id: "agent" },
			),
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
