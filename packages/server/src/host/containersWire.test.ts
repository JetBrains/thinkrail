import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Container, Project, Workspace } from "@thinkrail/contracts";
import { CONTAINER_PROTOCOL_VERSION, PROTOCOL_VERSION, WS_CHANNELS } from "@thinkrail/contracts";
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
const root = realpathSync.native(mkdtempSync(join(tmpdir(), "trpi-containers-wire-")));
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
				if (!frame.ok) throw new Error(frame.error);
				return frame.result as T;
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

test("container pushes reach only sockets at the container protocol", async () => {
	const repo = join(root, "repo");
	mkdirSync(repo);
	git(repo, "init", "-q", "-b", "main");
	git(repo, "commit", "-q", "--allow-empty", "-m", "init");
	const worktree = join(root, "attached");
	git(repo, "worktree", "add", "-q", "-b", "feature", worktree);

	const older = await connect("older", CONTAINER_PROTOCOL_VERSION - 1);
	const current = await connect("current", PROTOCOL_VERSION);
	try {
		const project = await current.request<Project>("project.open", { path: repo });
		const attached = await current.request<Workspace>("workspace.openExisting", {
			projectId: project.id,
			path: worktree,
		});
		const container = await current.request<Container>("container.create", {
			workspaceIds: [attached.id],
		});
		await current.request("workspace.remove", { id: attached.id });
		await older.request("project.list", {});
		await current.request("project.list", {});

		const containerFrames = (client: Client) =>
			client.frames.filter(
				(frame) =>
					frame.channel === WS_CHANNELS.containerUpdated ||
					frame.channel === WS_CHANNELS.containerRemoved,
			);
		expect(containerFrames(current)).toEqual([
			{ channel: WS_CHANNELS.containerUpdated, data: container },
			{ channel: WS_CHANNELS.containerRemoved, data: { id: container.id } },
		]);
		expect(containerFrames(older)).toEqual([]);
		expect(await current.request<Container[]>("container.list", {})).toEqual([]);
	} finally {
		older.close();
		current.close();
	}
}, 30_000);

test("workspace.startCreate into a container joins the new workspace as it is handed over", async () => {
	const repo = join(root, "repo-into");
	mkdirSync(repo);
	git(repo, "init", "-q", "-b", "main");
	git(repo, "commit", "-q", "--allow-empty", "-m", "init");
	const worktree = join(root, "attached-into");
	git(repo, "worktree", "add", "-q", "-b", "feature-into", worktree);

	const client = await connect("into", PROTOCOL_VERSION);
	try {
		const project = await client.request<Project>("project.open", { path: repo });
		const attached = await client.request<Workspace>("workspace.openExisting", {
			projectId: project.id,
			path: worktree,
		});
		const container = await client.request<Container>("container.create", {
			workspaceIds: [attached.id],
		});
		await expect(
			client.request("workspace.startCreate", { projectId: project.id, into: "missing" }),
		).rejects.toThrow("Unknown container: missing");

		const creation = await client.request<{ id: string }>("workspace.startCreate", {
			projectId: project.id,
			baseRef: "feature-into",
			into: container.id,
		});
		const removedFrame = (frame: Frame) =>
			frame.channel === WS_CHANNELS.workspaceCreationRemoved &&
			(frame.data as { id?: string }).id === creation.id;
		for (let waited = 0; !client.frames.some(removedFrame) && waited < 200; waited += 1)
			await Bun.sleep(100);
		const removed = client.frames.findIndex(removedFrame);
		const joined = client.frames.findIndex(
			(frame) =>
				frame.channel === WS_CHANNELS.containerUpdated &&
				(frame.data as Container).workspaceIds.includes(creation.id),
		);
		expect(removed).toBeGreaterThan(-1);
		expect(joined).toBeGreaterThan(-1);
		expect(joined).toBeLessThan(removed);
		const listed = await client.request<Container[]>("container.list", {});
		expect(listed.find((candidate) => candidate.id === container.id)?.workspaceIds).toEqual([
			attached.id,
			creation.id,
		]);
	} finally {
		client.close();
	}
}, 30_000);
