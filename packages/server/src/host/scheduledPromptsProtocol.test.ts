import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	CONTINUATION_PROTOCOL_VERSION,
	PROTOCOL_VERSION,
	SCHEDULED_PROMPTS_PROTOCOL_VERSION,
	WS_CHANNELS,
} from "@thinkrail/contracts";
import { configurePiRuntime, configurePiRuntimeFactory } from "../agent";
import { resetAnalyticsForTests } from "../analytics";
import { resetJbcentralStateForTests } from "../auth";
import { resetConfigCache } from "../settings";
import { createServer, type RunningServer } from "./server";

interface Frame {
	channel?: string;
	data?: unknown;
	error?: string;
	id?: string;
	ok?: boolean;
}

interface Client {
	socket: WebSocket;
	frames: Frame[];
	waitFor(matches: (frame: Frame) => boolean): Promise<Frame>;
}

function connect(port: number, client: string, protocol: number): Promise<Client> {
	const socket = new WebSocket(`ws://127.0.0.1:${port}/ws?client=${client}&protocol=${protocol}`);
	const frames: Frame[] = [];
	const waiters = new Set<{ matches: (frame: Frame) => boolean; resolve(frame: Frame): void }>();
	socket.addEventListener("message", (event) => {
		const frame = JSON.parse(String(event.data)) as Frame;
		frames.push(frame);
		for (const waiter of waiters) {
			if (!waiter.matches(frame)) continue;
			waiters.delete(waiter);
			waiter.resolve(frame);
		}
	});
	return new Promise((resolve, reject) => {
		socket.addEventListener(
			"open",
			() => {
				const client: Client = {
					socket,
					frames,
					waitFor(matches) {
						const frame = frames.find(matches);
						if (frame) return Promise.resolve(frame);
						return new Promise((done) => waiters.add({ matches, resolve: done }));
					},
				};
				void client
					.waitFor((frame) => frame.channel === WS_CHANNELS.serverWelcome)
					.then(() => resolve(client));
			},
			{ once: true },
		);
		socket.addEventListener("error", () => reject(new Error("websocket failed to open")), {
			once: true,
		});
	});
}

const sockets: WebSocket[] = [];
const tempDirs: string[] = [];
const originalDataDir = process.env.THINKRAIL_DATA_DIR;
let server: RunningServer | undefined;

afterEach(async () => {
	for (const socket of sockets.splice(0)) socket.close();
	await server?.shutdown();
	server = undefined;
	resetAnalyticsForTests();
	resetConfigCache();
	await resetJbcentralStateForTests();
	configurePiRuntimeFactory();
	configurePiRuntime(null);
	while (tempDirs.length) rmSync(tempDirs.pop() as string, { recursive: true, force: true });
	if (originalDataDir === undefined) delete process.env.THINKRAIL_DATA_DIR;
	else process.env.THINKRAIL_DATA_DIR = originalDataDir;
});

test("scheduled prompt requests and events are unavailable to the v110 main client", async () => {
	expect(CONTINUATION_PROTOCOL_VERSION).toBe(110);
	expect(SCHEDULED_PROMPTS_PROTOCOL_VERSION).toBeGreaterThan(CONTINUATION_PROTOCOL_VERSION);
	expect(PROTOCOL_VERSION).toBe(SCHEDULED_PROMPTS_PROTOCOL_VERSION);
	const dataDir = mkdtempSync(join(tmpdir(), "thinkrail-scheduled-protocol-"));
	tempDirs.push(dataDir);
	process.env.THINKRAIL_DATA_DIR = dataDir;
	writeFileSync(
		join(dataDir, "scheduled-prompts.json"),
		JSON.stringify([
			{
				id: "scheduled-protocol-check",
				workspaceId: "missing-workspace",
				sessionId: "missing-session",
				text: "test only",
				dueAt: Date.now() + 3_600_000,
				createdAt: Date.now(),
				savedOrder: 1,
				status: "scheduled",
			},
		]),
	);
	resetConfigCache();
	await resetJbcentralStateForTests();
	configurePiRuntime(null);
	configurePiRuntimeFactory();
	server = await createServer({ port: 0, host: "127.0.0.1", analytics: { mute: true } });
	const [current, main] = await Promise.all([
		connect(server.port, "scheduled-protocol-current", SCHEDULED_PROMPTS_PROTOCOL_VERSION),
		connect(server.port, "scheduled-protocol-main", CONTINUATION_PROTOCOL_VERSION),
	]);
	sockets.push(current.socket, main.socket);
	const dueAt = Date.now() + 3_600_000;
	const legacyRequests = [
		["scheduledPrompts.list", { workspaceId: "missing-workspace" }],
		[
			"scheduledPrompts.create",
			{
				requestId: "legacy-create",
				workspaceId: "missing-workspace",
				sessionId: "missing-session",
				text: "must not be saved",
				dueAt,
				createdAt: Date.now(),
				status: "scheduled",
			},
		],
		[
			"scheduledPrompts.update",
			{
				id: "scheduled-protocol-check",
				workspaceId: "missing-workspace",
				text: "must not be updated",
				dueAt,
			},
		],
		[
			"scheduledPrompts.sendNow",
			{ id: "scheduled-protocol-check", workspaceId: "missing-workspace" },
		],
		[
			"scheduledPrompts.cancel",
			{ id: "scheduled-protocol-check", workspaceId: "missing-workspace" },
		],
	] as const;
	for (const [index, [method, params]] of legacyRequests.entries()) {
		const id = `legacy-scheduled-${index}`;
		main.socket.send(JSON.stringify({ id, method, params }));
		const response = await main.waitFor((frame) => frame.id === id);
		expect(response.ok).toBe(false);
		expect(response.error).toBe(
			`scheduled prompts require protocol version ${SCHEDULED_PROMPTS_PROTOCOL_VERSION} or later`,
		);
	}
	expect(main.frames.some((frame) => frame.channel === WS_CHANNELS.scheduledPromptsChanged)).toBe(
		false,
	);
	current.socket.send(
		JSON.stringify({
			id: "send-scheduled-now",
			method: "scheduledPrompts.sendNow",
			params: { id: "scheduled-protocol-check", workspaceId: "missing-workspace" },
		}),
	);
	const changed = await current.waitFor(
		(frame) => frame.channel === WS_CHANNELS.scheduledPromptsChanged,
	);
	const response = await current.waitFor((frame) => frame.id === "send-scheduled-now");
	await Bun.sleep(50);
	expect(changed.channel).toBe(WS_CHANNELS.scheduledPromptsChanged);
	expect(response.ok).toBe(true);
	expect(main.frames.some((frame) => frame.channel === WS_CHANNELS.scheduledPromptsChanged)).toBe(
		false,
	);
});
