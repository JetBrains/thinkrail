import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PROTOCOL_VERSION, WS_CHANNELS } from "@thinkrail/contracts";
import { configurePiRuntime } from "../agent";
import { resetAnalyticsForTests } from "../analytics";
import { resetJbcentralStateForTests } from "../auth";
import { resetConfigCache } from "../settings";
import { createServer, type RunningServer } from "./server";
import { CLOSE_OPCODE, serverFrames, stalledClient, until } from "./testFixtures";

const LIMIT_BYTES = 4 * 1024 * 1024;
const BIG_SETTING = "x".repeat(256 * 1024);
const UPDATES = 96;
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
	const stalled = await stalledClient(server.port, "stalled");

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
