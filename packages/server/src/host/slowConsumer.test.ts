import { afterAll, beforeAll, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { connect, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PROTOCOL_VERSION, WS_CHANNELS } from "@thinkrail/contracts";
import { configurePiRuntime } from "../agent";
import { resetAnalyticsForTests } from "../analytics";
import { resetJbcentralStateForTests } from "../auth";
import { resetConfigCache } from "../settings";
import { createServer, type RunningServer } from "./server";

const LIMIT_BYTES = 4 * 1024 * 1024;
const BIG_SETTING = "x".repeat(256 * 1024);
const UPDATES = 96;
const CLOSE_OPCODE = 0x8;
const saved = {
	agent: process.env.PI_CODING_AGENT_DIR,
	data: process.env.THINKRAIL_DATA_DIR,
	offline: process.env.PI_OFFLINE,
};
const root = realpathSync.native(mkdtempSync(join(tmpdir(), "trpi-slow-consumer-")));
let server: RunningServer;

beforeAll(async () => {
	process.env.THINKRAIL_DATA_DIR = join(root, "data");
	process.env.PI_CODING_AGENT_DIR = join(root, "agent");
	process.env.PI_OFFLINE = "1";
	resetConfigCache();
	await resetJbcentralStateForTests();
	configurePiRuntime(null);
	server = await createServer({
		port: 0,
		host: "127.0.0.1",
		outboundBufferLimitBytes: LIMIT_BYTES,
	});
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

interface ServerFrame {
	opcode: number;
	text: string;
}

function serverFrames(received: Buffer): ServerFrame[] {
	const frames: ServerFrame[] = [];
	let offset = received.indexOf("\r\n\r\n") + 4;
	while (offset + 2 <= received.length) {
		const opcode = (received[offset] ?? 0) & 0x0f;
		let length = (received[offset + 1] ?? 0) & 0x7f;
		let header = 2;
		if (length === 126) {
			length = received.readUInt16BE(offset + 2);
			header = 4;
		} else if (length === 127) {
			length = Number(received.readBigUInt64BE(offset + 2));
			header = 10;
		}
		if (offset + header + length > received.length) break;
		frames.push({
			opcode,
			text: received.subarray(offset + header, offset + header + length).toString(),
		});
		offset += header + length;
	}
	return frames;
}

async function until(condition: () => boolean, what: string, timeoutMs = 15_000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (!condition()) {
		if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
		await Bun.sleep(10);
	}
}

async function stalledClient(
	clientKey: string,
): Promise<{ socket: Socket; received: () => Buffer }> {
	const chunks: Buffer[] = [];
	const socket = connect(server.port, "127.0.0.1");
	socket.on("data", (chunk: Buffer) => chunks.push(chunk));
	socket.write(
		[
			`GET /ws?client=${clientKey}&protocol=${PROTOCOL_VERSION} HTTP/1.1`,
			`Host: 127.0.0.1:${server.port}`,
			"Upgrade: websocket",
			"Connection: Upgrade",
			`Sec-WebSocket-Key: ${randomBytes(16).toString("base64")}`,
			"Sec-WebSocket-Version: 13",
			"",
			"",
		].join("\r\n"),
	);
	const received = () => Buffer.concat(chunks);
	await until(
		() => serverFrames(received()).some((frame) => frame.text.includes(WS_CHANNELS.serverWelcome)),
		"the stalled client's welcome",
	);
	socket.pause();
	return { socket, received };
}

test("a client that stops reading past the buffer limit is closed while a healthy one gets every push", async () => {
	const healthy = new WebSocket(
		`ws://127.0.0.1:${server.port}/ws?client=healthy&protocol=${PROTOCOL_VERSION}`,
	);
	let healthyPushes = 0;
	let healthyClosed = false;
	const replies = new Set<string>();
	healthy.addEventListener("message", (event) => {
		const frame = JSON.parse(String(event.data)) as { channel?: string; id?: string };
		if (frame.channel === WS_CHANNELS.settingsChanged) healthyPushes += 1;
		if (frame.id) replies.add(frame.id);
	});
	healthy.addEventListener("close", () => {
		healthyClosed = true;
	});
	await new Promise((resolve) => healthy.addEventListener("open", resolve, { once: true }));
	const stalled = await stalledClient("stalled");

	const update = (id: string, settings: Record<string, boolean>) =>
		healthy.send(
			JSON.stringify({
				id,
				method: "settings.update",
				params: { config: { extensionSettings: { [BIG_SETTING]: settings } } },
			}),
		);
	for (let index = 0; index < UPDATES; index += 1) {
		update(`update-${index}`, { on: index % 2 === 0 });
		await until(() => replies.size === index + 1, `the reply to update ${index}`);
	}
	await until(() => healthyPushes === UPDATES, "every settings.changed push on the healthy client");
	expect(healthyClosed).toBe(false);

	stalled.socket.resume();
	await until(
		() => serverFrames(stalled.received()).some((frame) => frame.opcode === CLOSE_OPCODE),
		"the host's close frame on the stalled client",
	);
	const frames = serverFrames(stalled.received());
	const stalledPushes = frames.filter((frame) =>
		frame.text.includes(WS_CHANNELS.settingsChanged),
	).length;
	expect(stalledPushes).toBeGreaterThan(0);
	expect(stalledPushes).toBeLessThan(UPDATES);
	expect(frames.at(-1)?.opcode).toBe(CLOSE_OPCODE);
	stalled.socket.destroy();
	healthy.close();
}, 60_000);
