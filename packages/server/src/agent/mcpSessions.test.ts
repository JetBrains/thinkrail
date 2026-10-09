import { afterAll, afterEach, beforeAll, beforeEach, expect, spyOn, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { createFauxCore } from "@earendil-works/pi-ai/providers/faux";
import { AgentSession, ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent";
import { type ExtUiRequest, MCP_PROTOCOL_VERSION } from "@thinkrail/contracts";
import {
	createSession,
	disposeAllSessions,
	mcpSessionView,
	promptSession,
	reloadSessionResources,
	setSessionManagerFactory,
	setSessionMcpServerEnabled,
	settleSessionsForShutdown,
} from "./agentSessionManager";
import {
	hasFailedMcpReload,
	pendingMcpReload,
	reconcileMcpSessions,
	refreshMcpStatus,
	setMcpStatusPublisher,
	watchUserMcpConfig,
} from "./mcpSessions";
import { configurePiRuntime } from "./piRuntime";
import { createWebUiContext, type ExtUiAudience, setExtUiPublisher } from "./webUiContext";

const root = mkdtempSync(join(tmpdir(), "mcp-status-regressions-"));
const agentDir = join(root, "agent");
const cwd = join(root, "project");
const fixture = join(import.meta.dir, "mcp", "fixtures", "stdioServer.ts");
const saved = {
	agent: process.env.PI_CODING_AGENT_DIR,
	data: process.env.THINKRAIL_DATA_DIR,
	offline: process.env.PI_OFFLINE,
};
const faux = createFauxCore({
	provider: "mcp-status",
	api: "mcp-status",
	models: [
		{
			id: "fixture",
			name: "fixture",
			reasoning: false,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 100_000,
			maxTokens: 4096,
		},
	],
});
let notices: { request: ExtUiRequest; audience?: ExtUiAudience }[] = [];

function writeConfig(enabled = true): void {
	mkdirSync(agentDir, { recursive: true });
	writeFileSync(
		join(agentDir, "mcp.json"),
		JSON.stringify({
			mcpServers: {
				fixture: { command: process.execPath, args: [fixture], exposure: "direct", enabled },
			},
		}),
	);
}

beforeAll(async () => {
	process.env.PI_CODING_AGENT_DIR = agentDir;
	process.env.THINKRAIL_DATA_DIR = join(root, "data");
	process.env.PI_OFFLINE = "1";
	mkdirSync(cwd, { recursive: true });
	const runtime = await ModelRuntime.create({
		credentials: new InMemoryCredentialStore(),
		modelsPath: null,
		allowModelNetwork: false,
	});
	runtime.registerProvider("mcp-status", {
		api: faux.api,
		apiKey: "test",
		baseUrl: "http://faux.local",
		streamSimple: faux.streamSimple,
		models: [{ ...faux.getModel(), api: faux.api }],
	});
	configurePiRuntime(runtime);
	setSessionManagerFactory((dir) => SessionManager.inMemory(dir));
	setExtUiPublisher((request, audience) =>
		notices.push({ request, ...(audience ? { audience } : {}) }),
	);
});

beforeEach(() => {
	notices = [];
	writeConfig();
});

afterEach(async () => {
	await settleSessionsForShutdown();
	disposeAllSessions();
	rmSync(join(agentDir, "extensions"), { recursive: true, force: true });
});

afterAll(() => {
	configurePiRuntime(null);
	setSessionManagerFactory((dir) => SessionManager.create(dir));
	setExtUiPublisher(() => {});
	for (const [key, value] of Object.entries({
		PI_CODING_AGENT_DIR: saved.agent,
		THINKRAIL_DATA_DIR: saved.data,
		PI_OFFLINE: saved.offline,
	})) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
	rmSync(root, { recursive: true, force: true });
});

const chat = () =>
	createSession({
		workspaceId: "mcp-status-workspace",
		cwd,
		model: { ...faux.getModel(), thinkingLevels: ["off"] },
	});

async function waitFor(check: () => boolean | Promise<boolean>): Promise<void> {
	const until = Date.now() + 5_000;
	while (!(await check())) {
		if (Date.now() > until) throw new Error("MCP status did not converge");
		await Bun.sleep(20);
	}
}

const errorNotices = () =>
	notices.flatMap(({ request }) =>
		request.kind === "notify" && request.level === "error" ? [request] : [],
	);

function writeExtension(name: string, lines: string[]): string {
	const path = join(agentDir, "extensions", name);
	mkdirSync(join(agentDir, "extensions"), { recursive: true });
	writeFileSync(path, lines.join("\n"));
	return path;
}

test("legacy startup notifications mask the same credentials as status snapshots", async () => {
	const { sessionId } = await chat();
	await refreshMcpStatus(sessionId, 5_000);
	createWebUiContext(sessionId).notify(
		"MCP servers need attention:\n  fixture: failed: Authorization: Bearer private-token\nRun /mcp to fix.",
		"warning",
	);
	const legacy = notices.filter(({ audience }) => audience?.belowProtocol === MCP_PROTOCOL_VERSION);
	expect(legacy).toHaveLength(1);
	expect(JSON.stringify(legacy)).toContain("Bearer ***");
	expect(JSON.stringify(legacy)).not.toContain("private-token");
});

test("failed reconciliation is reported and retried even after the loaded configuration changed", async () => {
	const { sessionId } = await chat();
	await refreshMcpStatus(sessionId, 5_000);
	writeConfig(false);
	const original = AgentSession.prototype.reload;
	let attempts = 0;
	const reload = spyOn(AgentSession.prototype, "reload").mockImplementation(async function (
		this: AgentSession,
		options,
	) {
		attempts++;
		await original.call(this, options);
		if (attempts === 1) throw new Error("fixture failed with token=private-value");
	});
	try {
		await reconcileMcpSessions([sessionId]);
		expect(errorNotices()).toHaveLength(1);
		expect(errorNotices()[0]?.message).toContain("could not apply");
		expect(errorNotices()[0]?.message).toContain("token=***");
		expect(JSON.stringify(notices)).not.toContain("private-value");
		expect(mcpSessionView(sessionId)?.loaded?.get("fixture")?.enabled).toBe(false);
		expect(pendingMcpReload(sessionId).has("fixture")).toBe(true);
		expect(await reconcileMcpSessions([sessionId])).toEqual({ [sessionId]: "reloaded" });
		expect(attempts).toBe(2);
		expect(hasFailedMcpReload(sessionId)).toBe(false);
		expect(pendingMcpReload(sessionId).size).toBe(0);
		expect(await reconcileMcpSessions([sessionId])).toEqual({});
		expect(errorNotices()).toHaveLength(1);
	} finally {
		reload.mockRestore();
	}
});

test("a failed chat-local disable keeps its intent and retries the same value after the snapshot changed", async () => {
	const { sessionId } = await chat();
	await refreshMcpStatus(sessionId, 5_000);
	const original = AgentSession.prototype.reload;
	let attempts = 0;
	const reload = spyOn(AgentSession.prototype, "reload").mockImplementation(async function (
		this: AgentSession,
		options,
	) {
		attempts++;
		await original.call(this, options);
		if (attempts === 1) throw new Error("fixture failed with token=private-value");
	});
	try {
		await expect(setSessionMcpServerEnabled(sessionId, "fixture", false)).rejects.toThrow(
			"fixture failed",
		);
		expect(mcpSessionView(sessionId)?.disabledInChat.has("fixture")).toBe(true);
		expect(mcpSessionView(sessionId)?.loaded?.get("fixture")?.enabled).toBe(false);
		expect(hasFailedMcpReload(sessionId)).toBe(true);
		expect((await refreshMcpStatus(sessionId, 100))?.servers[0]?.state).toBe("pending-reload");
		expect(errorNotices()).toHaveLength(1);
		expect(errorNotices()[0]?.message).toContain("token=***");
		expect(JSON.stringify(notices)).not.toContain("private-value");
		expect(await setSessionMcpServerEnabled(sessionId, "fixture", false)).toBe("reloaded");
		expect(attempts).toBe(2);
		expect(hasFailedMcpReload(sessionId)).toBe(false);
		expect(pendingMcpReload(sessionId).size).toBe(0);
		expect((await refreshMcpStatus(sessionId, 100))?.servers[0]?.state).toBe("disabled-in-chat");
		expect(await setSessionMcpServerEnabled(sessionId, "fixture", false)).toBe("unchanged");
		expect(await reconcileMcpSessions([sessionId])).toEqual({});
		expect(attempts).toBe(2);
		expect(errorNotices()).toHaveLength(1);
	} finally {
		reload.mockRestore();
	}
});

test("same-value disable retries after a failed loader cleared its snapshot, without admitting unknown names", async () => {
	const { sessionId } = await chat();
	await refreshMcpStatus(sessionId, 5_000);
	const original = AgentSession.prototype.reload;
	let attempts = 0;
	const reload = spyOn(AgentSession.prototype, "reload").mockImplementation(async function (
		this: AgentSession,
		options,
	) {
		attempts++;
		if (attempts === 1) {
			await this.resourceLoader.reload();
			throw new Error("fixture loader failed");
		}
		await original.call(this, options);
	});
	try {
		await expect(setSessionMcpServerEnabled(sessionId, "fixture", false)).rejects.toThrow(
			"fixture loader failed",
		);
		expect(mcpSessionView(sessionId)?.loaded).toBeNull();
		expect(hasFailedMcpReload(sessionId)).toBe(true);
		await expect(setSessionMcpServerEnabled(sessionId, "missing", false)).rejects.toThrow(
			"No MCP server",
		);
		expect(attempts).toBe(1);
		expect(await setSessionMcpServerEnabled(sessionId, "fixture", false)).toBe("reloaded");
		expect(attempts).toBe(2);
		expect(hasFailedMcpReload(sessionId)).toBe(false);
		expect((await refreshMcpStatus(sessionId, 100))?.servers[0]?.state).toBe("disabled-in-chat");
		expect(errorNotices()).toHaveLength(1);
	} finally {
		reload.mockRestore();
	}
});

test("a deferred reconciliation failure is reported once and retried without another config change", async () => {
	const hold = join(root, "hold");
	const entered = join(root, "hold-entered");
	writeFileSync(hold, "");
	writeExtension("hold.ts", [
		'import { existsSync, writeFileSync } from "node:fs";',
		"export default function hold(pi) {",
		'  pi.registerCommand("hold", {',
		"    handler: async () => {",
		`      writeFileSync(${JSON.stringify(entered)}, "");`,
		`      while (existsSync(${JSON.stringify(hold)})) await new Promise(resolve => setTimeout(resolve, 10));`,
		"    },",
		"  });",
		"}",
	]);
	const original = AgentSession.prototype.reload;
	let attempts = 0;
	let command: Promise<void> | undefined;
	const reload = spyOn(AgentSession.prototype, "reload").mockImplementation(async function (
		this: AgentSession,
		options,
	) {
		attempts++;
		await original.call(this, options);
		if (attempts === 1) throw new Error("fixture failed with token=private-value");
	});
	try {
		const { sessionId } = await chat();
		await refreshMcpStatus(sessionId, 5_000);
		command = promptSession(sessionId, "/hold");
		await waitFor(() => existsSync(entered));
		writeConfig(false);
		expect(await reconcileMcpSessions([sessionId])).toEqual({ [sessionId]: "deferred" });
		expect(attempts).toBe(0);
		expect((await refreshMcpStatus(sessionId, 100))?.servers[0]?.state).toBe("pending-reload");
		rmSync(hold);
		await command;
		await waitFor(() => hasFailedMcpReload(sessionId));
		await Bun.sleep(100);
		expect(attempts).toBe(1);
		expect(errorNotices()).toHaveLength(1);
		expect(errorNotices()[0]?.message).toContain("could not apply");
		expect(errorNotices()[0]?.message).toContain("token=***");
		expect(JSON.stringify(notices)).not.toContain("private-value");
		expect(mcpSessionView(sessionId)?.loaded?.get("fixture")?.enabled).toBe(false);
		expect(pendingMcpReload(sessionId).has("fixture")).toBe(true);
		expect((await refreshMcpStatus(sessionId, 100))?.servers[0]?.state).toBe("pending-reload");
		expect(await reconcileMcpSessions([sessionId])).toEqual({ [sessionId]: "reloaded" });
		expect(attempts).toBe(2);
		expect(hasFailedMcpReload(sessionId)).toBe(false);
		expect(pendingMcpReload(sessionId).size).toBe(0);
		expect((await refreshMcpStatus(sessionId, 100))?.servers[0]?.state).toBe("disabled");
		expect(await reconcileMcpSessions([sessionId])).toEqual({});
		await Bun.sleep(100);
		expect(attempts).toBe(2);
		expect(errorNotices()).toHaveLength(1);
	} finally {
		rmSync(hold, { force: true });
		await command;
		reload.mockRestore();
		rmSync(entered, { force: true });
	}
});

for (const previouslyManaged of [true, false]) {
	test(`a manual reload failure after MCP replacement is retryable only if previously managed: ${previouslyManaged}`, async () => {
		const replacement = () =>
			writeExtension("other-mcp.ts", [
				"export default function otherMcp(pi) {",
				'  pi.registerCommand("mcp", { handler: async () => {} });',
				"}",
			]);
		if (!previouslyManaged) replacement();
		const { sessionId } = await chat();
		await refreshMcpStatus(sessionId, 5_000);
		const path = replacement();
		const original = AgentSession.prototype.reload;
		let attempts = 0;
		const reload = spyOn(AgentSession.prototype, "reload").mockImplementation(async function (
			this: AgentSession,
			options,
		) {
			attempts++;
			await original.call(this, options);
			if (attempts === 1) throw new Error("fixture failed with token=private-value");
		});
		try {
			await expect(reloadSessionResources(sessionId)).rejects.toThrow("fixture failed");
			expect(mcpSessionView(sessionId)?.loaded).toBeNull();
			expect(hasFailedMcpReload(sessionId)).toBe(previouslyManaged);
			expect(errorNotices()).toHaveLength(previouslyManaged ? 1 : 0);
			expect(JSON.stringify(notices)).not.toContain("private-value");
			rmSync(path);
			expect(await reconcileMcpSessions([sessionId])).toEqual(
				previouslyManaged ? { [sessionId]: "reloaded" } : {},
			);
			expect(attempts).toBe(previouslyManaged ? 2 : 1);
			expect(hasFailedMcpReload(sessionId)).toBe(false);
			expect(await reconcileMcpSessions([sessionId])).toEqual({});
			expect(errorNotices()).toHaveLength(previouslyManaged ? 1 : 0);
		} finally {
			reload.mockRestore();
		}
	});
}

for (const close of [settleSessionsForShutdown, disposeAllSessions]) {
	test(`a late reload failure after ${close.name} stays silent and never restarts status`, async () => {
		const { sessionId } = await chat();
		await refreshMcpStatus(sessionId, 5_000);
		const updates: string[] = [];
		setMcpStatusPublisher((snapshot) => updates.push(snapshot.sessionId));
		const original = AgentSession.prototype.reload;
		let entered = false;
		let released = false;
		const reload = spyOn(AgentSession.prototype, "reload").mockImplementation(async function (
			this: AgentSession,
			options,
		) {
			await original.call(this, options);
			entered = true;
			await waitFor(() => released);
			throw new Error("fixture failed with token=private-value");
		});
		const reloading = reloadSessionResources(sessionId).then(
			() => null,
			(error: unknown) => error,
		);
		try {
			await waitFor(() => entered);
			await close();
			const before = updates.length;
			released = true;
			expect(await reloading).toEqual(new Error("fixture failed with token=private-value"));
			await Bun.sleep(100);
			expect(errorNotices()).toHaveLength(0);
			expect(hasFailedMcpReload(sessionId)).toBe(false);
			expect(updates).toHaveLength(before);
			expect(await reconcileMcpSessions([sessionId])).toEqual({});
		} finally {
			released = true;
			await reloading;
			reload.mockRestore();
			setMcpStatusPublisher(() => {});
		}
	});
}

test("the user-config watcher follows a recreated agent directory", async () => {
	const { sessionId } = await chat();
	await refreshMcpStatus(sessionId, 5_000);
	const stop = watchUserMcpConfig();
	try {
		rmSync(agentDir, { recursive: true, force: true });
		writeConfig(false);
		await waitFor(
			async () =>
				(await refreshMcpStatus(sessionId, 100))?.servers.some(
					(server) => server.state === "disabled",
				) === true,
		);
		writeConfig(true);
		await waitFor(
			async () =>
				(await refreshMcpStatus(sessionId, 100))?.servers.some(
					(server) => server.state === "connected",
				) === true,
		);
	} finally {
		stop();
	}
});
