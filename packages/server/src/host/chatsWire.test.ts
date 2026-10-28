import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { createFauxCore, fauxAssistantMessage } from "@earendil-works/pi-ai/providers/faux";
import { ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent";
import type { ChatCreateResult, Workspace, WsResult } from "@thinkrail/contracts";
import { CHATS_PROTOCOL_VERSION, WS_CHANNELS } from "@thinkrail/contracts";
import {
	configurePiRuntime,
	configurePiRuntimeFactory,
	notifyExtUi,
	promptSession,
	setSessionManagerFactory,
} from "../agent";
import { resetAnalyticsForTests } from "../analytics";
import { resetJbcentralStateForTests } from "../auth";
import { resetChatsStoreForTests } from "../persistence";
import { openProject } from "../projects";
import { resetConfigCache, updateConfig } from "../settings";
import { setTrashImplementationForTests } from "../trash";
import { resetChatIdCache } from "../workspaces";
import { createServer, type RunningServer } from "./server";

interface Frame {
	channel?: string;
	data?: unknown;
	id?: string;
	ok?: boolean;
	result?: unknown;
	error?: string;
}

interface Client {
	frames: Frame[];
	request(method: string, params: unknown): Promise<unknown>;
	close(): void;
}

const model = {
	id: "wire-model",
	name: "wire-model",
	reasoning: false,
	input: ["text"] as ("text" | "image")[],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 100_000,
	maxTokens: 4096,
};
const faux = createFauxCore({
	provider: "wire",
	api: "wire",
	models: [model],
	tokensPerSecond: 10000,
});
const saved = {
	agent: process.env.PI_CODING_AGENT_DIR,
	data: process.env.THINKRAIL_DATA_DIR,
	offline: process.env.PI_OFFLINE,
	ceiling: process.env.GIT_CEILING_DIRECTORIES,
};
const root = realpathSync.native(mkdtempSync(join(tmpdir(), "trpi-chats-wire-")));
let server: RunningServer;
let nextRequest = 0;

function gitRepo(path: string): string {
	mkdirSync(path, { recursive: true });
	for (const args of [
		["init", "-b", "main"],
		[
			"-c",
			"user.email=t@thinkrail.test",
			"-c",
			"user.name=test",
			"commit",
			"--allow-empty",
			"-m",
			"init",
		],
	]) {
		const result = Bun.spawnSync(["git", "-C", path, ...args], { stdout: "pipe", stderr: "pipe" });
		if (!result.success) throw new Error(`git ${args.join(" ")} failed`);
	}
	writeFileSync(join(path, "README.md"), "# repo\n");
	return path;
}

async function connect(client: string, protocol: number): Promise<Client> {
	const socket = new WebSocket(
		`ws://127.0.0.1:${server.port}/ws?client=${client}&protocol=${protocol}`,
	);
	const frames: Frame[] = [];
	const waiting = new Map<string, (frame: Frame) => void>();
	let welcomed: () => void = () => {};
	const welcome = new Promise<void>((resolve) => {
		welcomed = resolve;
	});
	socket.addEventListener("message", (event) => {
		const frame = JSON.parse(String(event.data)) as Frame;
		frames.push(frame);
		if (frame.channel === WS_CHANNELS.serverWelcome) welcomed();
		if (frame.id) waiting.get(frame.id)?.(frame);
	});
	await welcome;
	return {
		frames,
		request: (method, params) => {
			const id = `r${++nextRequest}`;
			const answered = new Promise<Frame>((resolve) => waiting.set(id, resolve));
			socket.send(JSON.stringify({ id, method, params }));
			return answered.then((frame) => {
				if (!frame.ok) throw new Error(frame.error);
				return frame.result;
			});
		},
		close: () => socket.close(),
	};
}

beforeAll(async () => {
	process.env.THINKRAIL_DATA_DIR = join(root, "data");
	process.env.PI_CODING_AGENT_DIR = join(root, "agent");
	process.env.PI_OFFLINE = "1";
	resetConfigCache();
	resetChatIdCache();
	resetChatsStoreForTests();
	await resetJbcentralStateForTests();
	const runtime = await ModelRuntime.create({
		credentials: new InMemoryCredentialStore(),
		modelsPath: null,
		allowModelNetwork: false,
	});
	runtime.registerProvider("wire", {
		api: faux.api,
		apiKey: "test",
		baseUrl: "http://faux.local",
		streamSimple: faux.streamSimple,
		models: [{ ...model, api: faux.api }],
	});
	configurePiRuntime(null);
	configurePiRuntimeFactory(async () => runtime);
	setSessionManagerFactory((cwd) => SessionManager.create(cwd));
	setTrashImplementationForTests(async (input) => {
		for (const path of typeof input === "string" ? [input] : input) {
			rmSync(path, { recursive: true, force: true });
		}
	});
	server = await createServer({ port: 0, host: "127.0.0.1" });
});

afterAll(async () => {
	await server.shutdown();
	resetAnalyticsForTests();
	await resetJbcentralStateForTests();
	configurePiRuntimeFactory();
	configurePiRuntime(null);
	setTrashImplementationForTests(undefined);
	resetConfigCache();
	resetChatIdCache();
	resetChatsStoreForTests();
	for (const [key, value] of [
		["PI_CODING_AGENT_DIR", saved.agent],
		["THINKRAIL_DATA_DIR", saved.data],
		["PI_OFFLINE", saved.offline],
		["GIT_CEILING_DIRECTORIES", saved.ceiling],
	] as const) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
	rmSync(root, { recursive: true, force: true });
});

test("an older socket hears nothing of a chat: not its records, its extension UI or a detached session's rename", async () => {
	const older = await connect("older", CHATS_PROTOCOL_VERSION - 1);
	const current = await connect("current", CHATS_PROTOCOL_VERSION);
	try {
		const created = (await current.request("chat.create", {})) as ChatCreateResult;
		const { workspace, sessionId } = created;
		notifyExtUi(sessionId, "a notice about the chat", "info");
		faux.setResponses([fauxAssistantMessage("persisted")]);
		await promptSession(sessionId, "persist this chat");
		await current.request("session.dispose", { sessionId });
		await current.request("session.rename", {
			sessionId,
			workspaceId: workspace.id,
			title: "Renamed on disk",
		});
		await older.request("project.list", {});
		await current.request("project.list", {});

		const pushes = (client: Client, channel: string) =>
			client.frames.filter((frame) => frame.channel === channel);
		expect(pushes(current, WS_CHANNELS.piExtensionUi)).toContainEqual(
			expect.objectContaining({
				data: expect.objectContaining({ sessionId, message: "a notice about the chat" }),
			}),
		);
		expect(pushes(current, WS_CHANNELS.piEvent)).toContainEqual(
			expect.objectContaining({
				data: { sessionId, event: { type: "session_info_changed", name: "Renamed on disk" } },
			}),
		);
		const aboutTheChat = (frame: Frame) =>
			frame.channel !== undefined &&
			[sessionId, workspace.id, workspace.projectId].some((id) =>
				JSON.stringify(frame.data ?? null).includes(id),
			);
		expect(older.frames.filter(aboutTheChat)).toEqual([]);
		expect(current.frames.filter(aboutTheChat).length).toBeGreaterThan(0);
		await current.request("chat.delete", { workspaceId: workspace.id });
	} finally {
		older.close();
		current.close();
	}
}, 30_000);

test("an older socket hears nothing of a chat's extension UI even while its session is still starting", async () => {
	const agentDir = process.env.PI_CODING_AGENT_DIR;
	if (!agentDir) throw new Error("agent dir not isolated");
	const extensionsDir = join(agentDir, "extensions");
	mkdirSync(extensionsDir, { recursive: true });
	const extensionPath = join(extensionsDir, "startup-notice.ts");
	writeFileSync(
		extensionPath,
		[
			'import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";',
			"export default function (pi: ExtensionAPI) {",
			'\tpi.on("session_start", async (_event, ctx) => {',
			'\t\tctx.ui.notify("a notice while the chat starts", "info");',
			"\t});",
			"}",
			"",
		].join("\n"),
	);
	const older = await connect("older-start", CHATS_PROTOCOL_VERSION - 1);
	const current = await connect("current-start", CHATS_PROTOCOL_VERSION);
	try {
		const { workspace, sessionId } = (await current.request("chat.create", {})) as ChatCreateResult;
		await older.request("project.list", {});
		const notices = (client: Client) =>
			client.frames.filter(
				(frame) =>
					frame.channel === WS_CHANNELS.piExtensionUi &&
					JSON.stringify(frame.data ?? null).includes(sessionId),
			);
		expect(notices(current)).toContainEqual(
			expect.objectContaining({
				data: expect.objectContaining({ sessionId, message: "a notice while the chat starts" }),
			}),
		);
		expect(notices(older)).toEqual([]);
		await current.request("chat.delete", { workspaceId: workspace.id });
	} finally {
		older.close();
		current.close();
		rmSync(extensionPath, { force: true });
	}
}, 30_000);

test("Agent review is never offered to a chat's session: neither the tool nor its guideline", async () => {
	updateConfig({ agentReviewEnabled: true });
	const client = await connect("review", CHATS_PROTOCOL_VERSION);
	const requests: string[] = [];
	const capture = (_context: unknown) => {
		requests.push(JSON.stringify(_context));
		return fauxAssistantMessage("ok");
	};
	try {
		const project = openProject(gitRepo(join(root, "review-repo")));
		const rows = (await client.request("workspace.list", {
			projectId: project.id,
		})) as Workspace[];
		const repository = (await client.request("session.create", {
			workspaceId: rows[0]?.id,
		})) as WsResult<"session.create">;
		const chat = (await client.request("chat.create", {})) as ChatCreateResult;
		faux.setResponses([capture, capture]);
		await promptSession(repository.sessionId, "review my step");
		await promptSession(chat.sessionId, "review my step");
		expect(requests).toHaveLength(2);
		expect(requests[0]).toContain("request_review");
		expect(requests[1]).not.toContain("request_review");
		await client.request("chat.delete", { workspaceId: chat.workspace.id });
	} finally {
		updateConfig({ agentReviewEnabled: false });
		client.close();
	}
}, 30_000);
