import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	EXTENSION_EVENT_PROTOCOL_VERSION,
	type ExtensionEventPush,
	PROTOCOL_VERSION,
	WS_CHANNELS,
} from "@thinkrail/contracts";
import { configurePiRuntime } from "../agent";
import { resetAnalyticsForTests } from "../analytics";
import { resetJbcentralStateForTests } from "../auth";
import { resetConfigCache } from "../settings";
import { createServer, type RunningServer } from "./server";

interface Frame {
	channel?: string;
	data?: unknown;
	id?: string;
	ok?: boolean;
	result?: unknown;
	error?: string;
	errorCode?: string;
}

interface Client {
	frames: Frame[];
	request<T>(method: string, params: unknown): Promise<T>;
	close(): void;
}

const saved = {
	agent: process.env.PI_CODING_AGENT_DIR,
	data: process.env.THINKRAIL_DATA_DIR,
	offline: process.env.PI_OFFLINE,
};
const root = realpathSync.native(mkdtempSync(join(tmpdir(), "trpi-extension-events-")));
const dataDir = join(root, "data");
let server: RunningServer;
let nextRequest = 0;

function git(cwd: string, ...args: string[]): void {
	const result = Bun.spawnSync(
		["git", "-C", cwd, "-c", "user.email=t@thinkrail.test", "-c", "user.name=test", ...args],
		{ stdout: "pipe", stderr: "pipe" },
	);
	if (!result.success) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
}

async function connect(client: string, protocol: number): Promise<Client> {
	const socket = new WebSocket(
		`ws://127.0.0.1:${server.port}/ws?client=${client}&protocol=${protocol}`,
	);
	const frames: Frame[] = [];
	const waiting = new Map<string, (frame: Frame) => void>();
	const welcome = new Promise<void>((resolve) => {
		socket.addEventListener("message", (event) => {
			const frame = JSON.parse(String(event.data)) as Frame;
			frames.push(frame);
			if (frame.channel === WS_CHANNELS.serverWelcome) resolve();
			if (frame.id) waiting.get(frame.id)?.(frame);
		});
	});
	await welcome;
	return {
		frames,
		request: <T>(method: string, params: unknown) => {
			const id = `r${++nextRequest}`;
			const answered = new Promise<Frame>((resolve) => waiting.set(id, resolve));
			socket.send(JSON.stringify({ id, method, params }));
			return answered.then((frame) => {
				if (!frame.ok) throw Object.assign(new Error(frame.error), { code: frame.errorCode });
				return frame.result as T;
			});
		},
		close: () => socket.close(),
	};
}

const BOUND = ["a", "b", "c"] as const;

beforeAll(async () => {
	process.env.THINKRAIL_DATA_DIR = dataDir;
	process.env.PI_CODING_AGENT_DIR = join(root, "agent");
	process.env.PI_OFFLINE = "1";
	const repo = join(root, "repo");
	mkdirSync(repo);
	git(repo, "init", "-q", "-b", "main");
	git(repo, "commit", "-q", "--allow-empty", "-m", "init");
	for (const name of BOUND) git(repo, "worktree", "add", "-q", "-b", name, join(root, name));
	mkdirSync(join(dataDir, "extensions", "board", "p1"), { recursive: true });
	writeFileSync(
		join(dataDir, "projects.json"),
		JSON.stringify([{ id: "p1", name: "ThinkRail", path: repo, slug: "thinkrail", lastOpened: 1 }]),
	);
	writeFileSync(
		join(dataDir, "workspaces.json"),
		JSON.stringify(
			BOUND.map((name) => ({
				id: `w-${name}`,
				projectId: "p1",
				kind: "external",
				name,
				branch: name,
				worktreePath: join(root, name),
				baseBranch: "main",
			})),
		),
	);
	writeFileSync(
		join(dataDir, "extensions", "board", "p1", "cards.json"),
		JSON.stringify({
			version: 1,
			prefix: "TR",
			nextNumber: 4,
			cards: BOUND.map((name, index) => ({
				id: `TR-${index + 1}`,
				title: `Card ${name}`,
				category: "started",
				column: "building",
				rank: index + 1,
				attempts: [
					{
						workspaceId: `w-${name}`,
						sessionId: `s-${name}`,
						workflow: "implement",
						startedAt: 1,
						notes: [],
					},
				],
			})),
		}),
	);
	resetConfigCache();
	await resetJbcentralStateForTests();
	configurePiRuntime(null);
	server = await createServer({ port: 0, host: "127.0.0.1" });
});

afterAll(async () => {
	await server.shutdown();
	resetAnalyticsForTests();
	await resetJbcentralStateForTests();
	configurePiRuntime(null);
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

const boardQuery = <T>(client: Client, method: string, params: unknown) =>
	client.request<T>("extension.query", { extension: "board", method, params });

async function cancelPending(client: Client, cardId: string): Promise<unknown> {
	const { card } = await boardQuery<{ card: { cancelPending?: unknown } }>(client, "card.get", {
		cardId,
	});
	return card.cancelPending;
}

async function eventually(check: () => Promise<boolean>): Promise<void> {
	for (let waited = 0; waited < 100; waited++) {
		if (await check()) return;
		await Bun.sleep(50);
	}
	throw new Error("timed out");
}

test("an extension's events reach only sockets at the extension-event protocol", async () => {
	const older = await connect("older", EXTENSION_EVENT_PROTOCOL_VERSION - 1);
	const current = await connect("current", PROTOCOL_VERSION);
	try {
		const card = await boardQuery<{ id: string }>(current, "card.create", {
			projectId: "p1",
			title: "Wire the board",
		});
		expect(card.id).toBe("TR-4");
		await older.request("project.list", {});
		await current.request("project.list", {});
		const events = (client: Client) =>
			client.frames.filter((frame) => frame.channel === WS_CHANNELS.extensionEvent);
		const changed: ExtensionEventPush = {
			extension: "board",
			type: "board.changed",
			payload: { projectId: "p1" },
		};
		expect(events(current)).toEqual([{ channel: WS_CHANNELS.extensionEvent, data: changed }]);
		expect(events(older)).toEqual([]);
	} finally {
		older.close();
		current.close();
	}
}, 30_000);

test("the board's host service follows host events, stops while switched off and starts again when on", async () => {
	const client = await connect("lifecycle", PROTOCOL_VERSION);
	try {
		await client.request("workspace.remove", { id: "w-a" });
		await eventually(async () => (await cancelPending(client, "TR-1")) !== undefined);
		expect(await cancelPending(client, "TR-1")).toMatchObject({ workspaceId: "w-a" });

		await client.request("settings.update", { config: { disabledExtensions: ["board"] } });
		await expect(boardQuery(client, "board.get", { projectId: "p1" })).rejects.toMatchObject({
			code: "EXTENSION_DISABLED",
		});
		await client.request("workspace.remove", { id: "w-b" });
		await Bun.sleep(200);

		await client.request("settings.update", { config: { disabledExtensions: [] } });
		await client.request("workspace.remove", { id: "w-c" });
		await eventually(async () => (await cancelPending(client, "TR-3")) !== undefined);
		expect(await cancelPending(client, "TR-2")).toBeUndefined();
	} finally {
		client.close();
	}
}, 30_000);
