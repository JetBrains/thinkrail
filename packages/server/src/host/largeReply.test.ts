import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Project, Workspace, WsResult } from "@thinkrail/contracts";
import { PROTOCOL_VERSION, WS_CHANNELS } from "@thinkrail/contracts";
import { configurePiRuntime } from "../agent";
import { resetAnalyticsForTests } from "../analytics";
import { resetJbcentralStateForTests } from "../auth";
import { resetConfigCache } from "../settings";
import { createServer, type RunningServer } from "./server";

interface Frame {
	channel?: string;
	id?: string;
	ok?: boolean;
	result?: unknown;
}

const BIG_FILE_BYTES = 24 * 1024 * 1024;
const saved = {
	agent: process.env.PI_CODING_AGENT_DIR,
	data: process.env.THINKRAIL_DATA_DIR,
	offline: process.env.PI_OFFLINE,
};
const root = realpathSync.native(mkdtempSync(join(tmpdir(), "trpi-large-reply-")));
let server: RunningServer;

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

test("replies queued behind one larger than Bun's default 16 MiB buffer still arrive on an open socket", async () => {
	const socket = new WebSocket(
		`ws://127.0.0.1:${server.port}/ws?client=large-reply&protocol=${PROTOCOL_VERSION}`,
	);
	const replies = new Map<string, Frame>();
	let closed = false;
	const welcomed = new Promise<void>((resolve) => {
		socket.addEventListener("message", (event) => {
			const frame = JSON.parse(String(event.data)) as Frame;
			if (frame.channel === WS_CHANNELS.serverWelcome) resolve();
			if (frame.id) replies.set(frame.id, frame);
		});
	});
	socket.addEventListener("close", () => {
		closed = true;
	});
	await welcomed;
	const send = (id: string, method: string, params: unknown) =>
		socket.send(JSON.stringify({ id, method, params }));
	const reply = async (id: string): Promise<Frame> => {
		const deadline = Date.now() + 10_000;
		while (!replies.has(id) && !closed && Date.now() < deadline) await Bun.sleep(10);
		const frame = replies.get(id);
		if (!frame) throw new Error(`no reply to ${id} (socket ${closed ? "closed" : "open"})`);
		return frame;
	};

	send("open", "project.open", { path: gitRepo(join(root, "repo")) });
	const project = (await reply("open")).result as Project;
	send("list", "workspace.list", { projectId: project.id, includeDiffStats: false });
	const [workspace] = (await reply("list")).result as Workspace[];
	if (!workspace) throw new Error("the opened project lists no workspace");
	writeFileSync(join(workspace.worktreePath, "big.txt"), "x".repeat(BIG_FILE_BYTES));

	send("big-1", "fs.readFile", { workspaceId: workspace.id, path: "big.txt" });
	send("big-2", "fs.readFile", { workspaceId: workspace.id, path: "big.txt" });
	send("small", "project.list", {});

	const small = await reply("small");
	await Bun.sleep(100);
	expect(closed).toBe(false);
	for (const id of ["big-1", "big-2"]) {
		const frame = await reply(id);
		expect(frame.ok).toBe(true);
		expect((frame.result as WsResult<"fs.readFile">).content).toHaveLength(BIG_FILE_BYTES);
	}
	expect(small.ok).toBe(true);
	socket.close();
}, 30_000);
