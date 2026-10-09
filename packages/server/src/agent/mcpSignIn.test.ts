import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { createFauxCore } from "@earendil-works/pi-ai/providers/faux";
import { ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent";
import type { ExtUiRequest, LoginFrame, LoginPush } from "@thinkrail/contracts";
import {
	createSession,
	dispatchSessionMcpCommand,
	disposeAllSessions,
	removeSession,
	setSessionManagerFactory,
	settleSessionsForShutdown,
} from "./agentSessionManager";
import { startOAuthMcpFixture } from "./mcp/fixtures/oauthServer";
import { refreshMcpStatus } from "./mcpSessions";
import {
	cancelMcpProbe,
	cancelMcpProbesOwnedBy,
	replyMcpProbe,
	setMcpLoginPublisher,
	startMcpProbe,
} from "./mcpSignIn";
import { configurePiRuntime } from "./piRuntime";
import { resolveExtUi, setExtUiPublisher } from "./webUiContext";

const faux = createFauxCore({
	provider: "signin",
	api: "signin",
	models: [
		{
			id: "signin",
			name: "signin",
			reasoning: false,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 100_000,
			maxTokens: 4096,
		},
	],
});
const saved = { agent: process.env.PI_CODING_AGENT_DIR, offline: process.env.PI_OFFLINE };
const root = mkdtempSync(join(tmpdir(), "mcp-signin-"));
const agentDir = join(root, "agent");
const cwd = join(root, "project");
const fixture = startOAuthMcpFixture();
let pushes: { push: LoginPush; owner: string }[] = [];
let requests: ExtUiRequest[] = [];

beforeAll(async () => {
	process.env.PI_CODING_AGENT_DIR = agentDir;
	process.env.PI_OFFLINE = "1";
	mkdirSync(agentDir, { recursive: true });
	mkdirSync(cwd, { recursive: true });
	writeFileSync(
		join(agentDir, "mcp.json"),
		JSON.stringify({ mcpServers: { oauthy: { url: fixture.url, exposure: "direct" } } }),
	);
	const runtime = await ModelRuntime.create({
		credentials: new InMemoryCredentialStore(),
		modelsPath: null,
		allowModelNetwork: false,
	});
	runtime.registerProvider("signin", {
		api: faux.api,
		apiKey: "test",
		baseUrl: "http://faux.local",
		streamSimple: faux.streamSimple,
		models: [{ ...faux.getModel(), api: faux.api }],
	});
	configurePiRuntime(runtime);
	setSessionManagerFactory((dir) => SessionManager.inMemory(dir));
	setMcpLoginPublisher((push, owner) => pushes.push({ push, owner }));
	setExtUiPublisher((request) => requests.push(request));
});

beforeEach(() => {
	pushes = [];
	requests = [];
});

afterAll(async () => {
	await settleSessionsForShutdown();
	disposeAllSessions();
	fixture.stop();
	setMcpLoginPublisher(() => {});
	setExtUiPublisher(() => {});
	configurePiRuntime(null);
	setSessionManagerFactory((dir) => SessionManager.create(dir));
	if (saved.agent === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = saved.agent;
	if (saved.offline === undefined) delete process.env.PI_OFFLINE;
	else process.env.PI_OFFLINE = saved.offline;
	rmSync(root, { recursive: true, force: true });
});

async function frameOf(loginId: string, kind: LoginFrame["kind"]): Promise<LoginFrame> {
	const until = Date.now() + 15_000;
	for (;;) {
		const found = pushes.find(
			(entry) => entry.push.loginId === loginId && entry.push.frame.kind === kind,
		);
		if (found) return found.push.frame;
		if (Date.now() > until) throw new Error(`no ${kind} frame`);
		await Bun.sleep(20);
	}
}

async function waitFor<T>(read: () => T | undefined): Promise<T> {
	const until = Date.now() + 15_000;
	for (;;) {
		const value = read();
		if (value !== undefined) return value;
		if (Date.now() > until) throw new Error("condition timed out");
		await Bun.sleep(20);
	}
}

const start = (action: "login" | "test" | "logout", deadlineMs?: number) =>
	startMcpProbe({
		action,
		workspaceId: "ws-signin",
		cwd,
		projectTrusted: false,
		policy: { approvals: {}, overrides: {} },
		serverName: "oauthy",
		ownerClientKey: "owner",
		...(deadlineMs !== undefined ? { deadlineMs } : {}),
	});

test("Test connection reports a reachable server that still needs sign-in", async () => {
	const { done } = start("test");
	expect(await done).toEqual({ kind: "error", message: "Reachable — needs sign-in." });
	expect(pushes.every((entry) => entry.owner === "owner")).toBe(true);
});

test("a failed Test connection reports pi's reason with credentials masked", async () => {
	const leaky = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch: () =>
			new Response('{"error":"rejected","api_key":"sk-live-abcdefgh12345678"}', { status: 400 }),
	});
	const config = join(agentDir, "mcp.json");
	const before = readFileSync(config, "utf8");
	writeFileSync(
		config,
		JSON.stringify({ mcpServers: { leaky: { url: `${leaky.url.origin}/mcp?token=abc` } } }),
	);
	try {
		const { done } = startMcpProbe({
			action: "test",
			workspaceId: "ws-signin",
			cwd,
			projectTrusted: false,
			policy: { approvals: {}, overrides: {} },
			serverName: "leaky",
			ownerClientKey: "owner",
		});
		const last = await done;
		expect(last.kind).toBe("error");
		expect(last.kind === "error" ? last.message : "").toContain('"api_key":"***"');
		expect(JSON.stringify(pushes)).not.toContain("sk-live");
	} finally {
		writeFileSync(config, before);
		leaky.stop(true);
	}
});

const oauthyState = async (sessionId: string) =>
	(await refreshMcpStatus(sessionId, 5000))?.servers.find((server) => server.name === "oauthy")
		?.state;

test("sign-in shows the https-or-loopback page, accepts only the owner's paste-back, and stores credentials", async () => {
	const chat = await createSession({ workspaceId: "ws-signin", cwd });
	expect(await oauthyState(chat.sessionId)).toBe("needs-sign-in");
	const { loginId, done } = start("login");
	const page = await frameOf(loginId, "authUrl");
	if (page.kind !== "authUrl") throw new Error("unexpected frame");
	const authorize = new URL(page.url);
	expect(authorize.origin).toBe(new URL(fixture.url).origin);
	expect(pushes.find((entry) => entry.push.loginId === loginId)?.push.target).toEqual({
		kind: "mcp",
		workspaceId: "ws-signin",
		serverName: "oauthy",
	});
	await frameOf(loginId, "prompt");
	expect(() => replyMcpProbe(loginId, "intruder", "http://127.0.0.1/evil")).toThrow(
		"started on another device",
	);
	const redirect = new URL(authorize.searchParams.get("redirect_uri") ?? "");
	redirect.searchParams.set("code", "fixture-code");
	redirect.searchParams.set("state", authorize.searchParams.get("state") ?? "");
	replyMcpProbe(loginId, "owner", redirect.href);
	expect(await done).toEqual({ kind: "success" });
	expect(fixture.tokenRequests()).toBeGreaterThan(0);
	expect(existsSync(join(agentDir, "mcp-auth.json"))).toBe(true);
	expect(await oauthyState(chat.sessionId)).toBe("connected");
	await removeSession(chat.sessionId);

	const tested = start("test");
	expect(await tested.done).toEqual({ kind: "success" });
	expect(
		pushes.some(
			(entry) =>
				entry.push.loginId === tested.loginId &&
				entry.push.frame.kind === "progress" &&
				entry.push.frame.message === "Connected · 1 tools",
		),
	).toBe(true);

	expect(await start("logout").done).toEqual({ kind: "success" });
	expect(readFileSync(join(agentDir, "mcp-auth.json"), "utf8")).not.toContain(
		"fixture-access-token",
	);
});

test("cancelling at the paste-back step ends the sign-in and frees the server for another attempt", async () => {
	const { loginId, done } = start("login");
	await frameOf(loginId, "prompt");
	expect(() => start("login")).toThrow("already running");
	expect(() => cancelMcpProbe(loginId, "intruder")).toThrow("started on another device");
	cancelMcpProbe(loginId, "owner");
	expect(await done).toEqual({ kind: "error", message: "Sign-in cancelled." });
	const retry = start("test");
	expect((await retry.done).kind).toBe("error");
});

const callbackOf = (frame: LoginFrame): string => {
	if (frame.kind !== "authUrl") throw new Error("unexpected frame");
	return new URL(frame.url).searchParams.get("redirect_uri") ?? "";
};

test("a sign-in left waiting past its deadline times out, closes pi's loopback listener, and frees the server", async () => {
	const { loginId, done } = start("login", 1_500);
	const callback = callbackOf(await frameOf(loginId, "authUrl"));
	await frameOf(loginId, "prompt");
	expect(await done).toEqual({ kind: "error", message: "Sign-in timed out." });
	expect(
		pushes.filter((entry) => entry.push.loginId === loginId && entry.push.frame.kind === "error"),
	).toHaveLength(1);
	expect(
		await fetch(callback).then(
			() => "listening",
			() => "closed",
		),
	).toBe("closed");
	expect((await start("test").done).kind).toBe("error");
});

test("reaping the owning client cancels its sign-in and frees the server", async () => {
	const { loginId, done } = start("login");
	await frameOf(loginId, "prompt");
	cancelMcpProbesOwnedBy("someone-else");
	expect(() => start("login")).toThrow("already running");
	cancelMcpProbesOwnedBy("owner");
	expect(await done).toEqual({ kind: "error", message: "Sign-in cancelled." });
	expect((await start("test").done).kind).toBe("error");
});

const chatRequests = (sessionId: string) =>
	requests.filter((request) => request.sessionId === sessionId);

test("a chat's own /mcp login holds the server's sign-in lock until it ends", async () => {
	const chat = await createSession({ workspaceId: "ws-signin", cwd });
	const login = dispatchSessionMcpCommand(chat.sessionId, "login oauthy");
	const asked = await waitFor(() =>
		chatRequests(chat.sessionId).find((request) => request.kind === "input"),
	);
	expect(() => start("login")).toThrow('A sign-in for "oauthy" is already running in a chat.');
	expect(() => start("test")).toThrow("already running");
	resolveExtUi({ id: asked.id, value: null });
	await login;
	expect((await start("test").done).kind).toBe("error");
	await removeSession(chat.sessionId);
});

test("a chat's /mcp login for a server the host's sign-in probe holds says so instead of starting", async () => {
	const chat = await createSession({ workspaceId: "ws-signin", cwd });
	const { loginId, done } = start("login");
	await frameOf(loginId, "prompt");
	await dispatchSessionMcpCommand(chat.sessionId, "login oauthy");
	await dispatchSessionMcpCommand(chat.sessionId, "logout oauthy");
	const seen = chatRequests(chat.sessionId);
	expect(
		seen.flatMap((request) =>
			request.kind === "notify" && !request.message.startsWith("MCP servers need attention")
				? [[request.message, request.level]]
				: [],
		),
	).toEqual([
		['A sign-in for "oauthy" is already running in Settings.', "warning"],
		['A sign-in for "oauthy" is already running in Settings.', "warning"],
	]);
	expect(seen.some((request) => request.kind === "input")).toBe(false);
	cancelMcpProbe(loginId, "owner");
	expect(await done).toEqual({ kind: "error", message: "Sign-in cancelled." });
	await removeSession(chat.sessionId);
});
