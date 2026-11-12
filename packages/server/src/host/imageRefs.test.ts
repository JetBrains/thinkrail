import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { createFauxCore, fauxAssistantMessage } from "@earendil-works/pi-ai/providers/faux";
import { ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent";
import type { Project, RefImage, TranscriptMessage, Workspace } from "@thinkrail/contracts";
import { IMAGES_ROUTE, isRefImage, PROTOCOL_VERSION, WS_CHANNELS } from "@thinkrail/contracts";
import { configurePiRuntime, configurePiRuntimeFactory, setSessionManagerFactory } from "../agent";
import { resetAnalyticsForTests } from "../analytics";
import { resetJbcentralStateForTests } from "../auth";
import { resetConfigCache } from "../settings";
import { setTrashImplementationForTests } from "../trash";
import { createServer, type RunningServer } from "./server";

interface Frame {
	channel?: string;
	id?: string;
	ok?: boolean;
	result?: unknown;
	error?: string;
}

const model = {
	id: "image-model",
	name: "image-model",
	reasoning: false,
	input: ["text", "image"] as ("text" | "image")[],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 100_000,
	maxTokens: 4096,
};
const faux = createFauxCore({ provider: "images", api: "images", models: [model] });
const saved = {
	agent: process.env.PI_CODING_AGENT_DIR,
	data: process.env.THINKRAIL_DATA_DIR,
	offline: process.env.PI_OFFLINE,
};
const root = realpathSync.native(mkdtempSync(join(tmpdir(), "trpi-image-refs-")));
const SCREENSHOT = Buffer.concat([
	Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]),
	Buffer.from("IHDR"),
	Buffer.from([0, 0, 3, 32, 0, 0, 2, 88]),
	Buffer.from("screenshot-bytes-that-must-not-ride-the-socket"),
]);
let server: RunningServer;

beforeAll(async () => {
	process.env.THINKRAIL_DATA_DIR = join(root, "data");
	process.env.PI_CODING_AGENT_DIR = join(root, "agent");
	process.env.PI_OFFLINE = "1";
	resetConfigCache();
	await resetJbcentralStateForTests();
	const runtime = await ModelRuntime.create({
		credentials: new InMemoryCredentialStore(),
		modelsPath: null,
		allowModelNetwork: false,
	});
	runtime.registerProvider("images", {
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

function gitRepo(path: string): string {
	mkdirSync(path, { recursive: true });
	const result = Bun.spawnSync(
		[
			"sh",
			"-c",
			"git init -q -b main && git -c user.email=t@thinkrail.test -c user.name=test commit -q --allow-empty -m init",
		],
		{ cwd: path, stdout: "pipe", stderr: "pipe" },
	);
	if (!result.success) throw new Error(`git init failed: ${result.stderr.toString()}`);
	return path;
}

async function connect() {
	const socket = new WebSocket(
		`ws://127.0.0.1:${server.port}/ws?client=image-refs&protocol=${PROTOCOL_VERSION}`,
	);
	const raw = new Map<string, string>();
	const welcomed = new Promise<void>((resolve) => {
		socket.addEventListener("message", (event) => {
			const text = String(event.data);
			const frame = JSON.parse(text) as Frame;
			if (frame.channel === WS_CHANNELS.serverWelcome) resolve();
			if (frame.id) raw.set(frame.id, text);
		});
	});
	await welcomed;
	let next = 0;
	return {
		async request(method: string, params: unknown): Promise<{ frame: Frame; text: string }> {
			const id = `r${++next}`;
			socket.send(JSON.stringify({ id, method, params }));
			const deadline = Date.now() + 10_000;
			while (!raw.has(id) && Date.now() < deadline) await Bun.sleep(10);
			const text = raw.get(id);
			if (text === undefined) throw new Error(`no reply to ${method}`);
			const frame = JSON.parse(text) as Frame;
			if (!frame.ok) throw new Error(frame.error);
			return { frame, text };
		},
		close: () => socket.close(),
	};
}

test("a transcript's images leave as references the route serves until the chat is deleted", async () => {
	const client = await connect();
	try {
		const { frame: opened } = await client.request("project.open", {
			path: gitRepo(join(root, "repo")),
		});
		const project = opened.result as Project;
		const { frame: listed } = await client.request("workspace.list", {
			projectId: project.id,
			includeDiffStats: false,
		});
		const [workspace] = listed.result as Workspace[];
		if (!workspace) throw new Error("the opened project lists no workspace");

		const manager = SessionManager.create(workspace.worktreePath);
		const data = SCREENSHOT.toString("base64");
		manager.appendMessage({
			role: "user",
			content: [
				{ type: "text", text: "what is on this screenshot?" },
				{ type: "image", data, mimeType: "image/png" },
			],
			timestamp: 1,
		});
		manager.appendMessage(fauxAssistantMessage("a login form", { timestamp: 2 }));
		const sessionId = manager.getSessionId();

		const { frame, text } = await client.request("session.getMessages", {
			workspaceId: workspace.id,
			sessionId,
		});
		expect(text).not.toContain(data);
		const messages = (frame.result as { messages: TranscriptMessage[] }).messages;
		const user = messages.find((message) => message.role === "user");
		const blocks = user && typeof user.content !== "string" ? user.content : [];
		const image = blocks.find(
			(block): block is RefImage => block.type === "image" && isRefImage(block),
		);
		if (!image) throw new Error("the transcript has no image reference");
		expect(image.ref.startsWith(`${IMAGES_ROUTE}${sessionId}/`)).toBe(true);
		expect({ width: image.width, height: image.height }).toEqual({ width: 800, height: 600 });

		const served = await fetch(`http://127.0.0.1:${server.port}${image.ref}`);
		expect(served.status).toBe(200);
		expect(served.headers.get("Content-Type")).toBe("image/png");
		expect(Buffer.from(await served.arrayBuffer()).equals(SCREENSHOT)).toBe(true);

		const posted = await fetch(`http://127.0.0.1:${server.port}${image.ref}`, { method: "POST" });
		expect(posted.status).toBe(405);

		await client.request("session.delete", { workspaceId: workspace.id, sessionId });
		const gone = await fetch(`http://127.0.0.1:${server.port}${image.ref}`);
		expect(gone.status).toBe(404);
	} finally {
		client.close();
	}
}, 30_000);
