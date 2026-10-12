import { afterAll, afterEach, beforeAll, beforeEach, expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { createFauxCore } from "@earendil-works/pi-ai/providers/faux";
import { AgentSession, ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent";
import type { ExtUiRequest } from "@thinkrail/contracts";
import {
	createSession,
	disposeAllSessions,
	setSessionManagerFactory,
	settleSessionsForShutdown,
} from "./agentSessionManager";
import {
	pendingMcpReload,
	reconcileMcpSessions,
	refreshMcpStatus,
	watchUserMcpConfig,
} from "./mcpSessions";
import { configurePiRuntime } from "./piRuntime";
import { createWebUiContext, setExtUiPublisher } from "./webUiContext";

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
let notices: { request: ExtUiRequest }[] = [];

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
	setExtUiPublisher((request) => notices.push({ request }));
});

beforeEach(() => {
	notices = [];
	writeConfig();
});

afterEach(async () => {
	await settleSessionsForShutdown();
	disposeAllSessions();
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

test("startup notifications mask the same credentials as status snapshots", async () => {
	const { sessionId } = await chat();
	await refreshMcpStatus(sessionId, 5_000);
	createWebUiContext(sessionId).notify(
		"MCP servers need attention:\n  fixture: failed: Authorization: Bearer private-token\nRun /mcp to fix.",
		"warning",
	);
	const legacy = notices.filter(
		({ request }) =>
			request.kind === "notify" && request.message.startsWith("MCP servers need attention:"),
	);
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
		expect(
			notices.some(
				({ request }) =>
					request.kind === "notify" &&
					request.level === "error" &&
					request.message.includes("could not apply"),
			),
		).toBe(true);
		expect(JSON.stringify(notices)).not.toContain("private-value");
		expect(pendingMcpReload(sessionId).has("fixture")).toBe(true);
		expect(await reconcileMcpSessions([sessionId])).toEqual({ [sessionId]: "reloaded" });
		expect(attempts).toBe(2);
		expect(pendingMcpReload(sessionId).size).toBe(0);
	} finally {
		reload.mockRestore();
	}
});

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
