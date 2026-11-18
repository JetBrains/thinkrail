import { afterAll, beforeAll, expect, spyOn, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PiEvent, SessionEventPayload } from "@thinkrail/contracts";
import { PROTOCOL_VERSION, WS_CHANNELS } from "@thinkrail/contracts";
import * as agent from "../agent";
import { resetAnalyticsForTests } from "../analytics";
import { resetJbcentralStateForTests } from "../auth";
import { resetConfigCache } from "../settings";
import { createServer, type RunningServer } from "./server";
import * as socketSend from "./socketSend";
import { CLOSE_OPCODE, serverFrames, stalledClient, until } from "./testFixtures";

const BIG_SETTING = "x".repeat(256 * 1024);
const SESSION = "conflation-session";
const saved = {
	agent: process.env.PI_CODING_AGENT_DIR,
	data: process.env.THINKRAIL_DATA_DIR,
	offline: process.env.PI_OFFLINE,
};
const root = realpathSync.native(mkdtempSync(join(tmpdir(), "trpi-conflation-")));
const realSend = socketSend.sendOrQuarantine;
const sockets = new Map<string, socketSend.OutboundSocket>();
const sendSpy = spyOn(socketSend, "sendOrQuarantine").mockImplementation((ws, ...rest) => {
	const { clientKey } = ws.data as { clientKey?: string };
	if (clientKey) sockets.set(clientKey, ws);
	return realSend(ws, ...rest);
});
let publish: ((payload: SessionEventPayload, workspaceId: string) => void) | undefined;
const realSetPublisher = agent.setSessionPublisher;
const publisherSpy = spyOn(agent, "setSessionPublisher").mockImplementation((fn) => {
	publish = fn;
	realSetPublisher(fn);
});
let server: RunningServer;

beforeAll(async () => {
	process.env.THINKRAIL_DATA_DIR = join(root, "data");
	process.env.PI_CODING_AGENT_DIR = join(root, "agent");
	process.env.PI_OFFLINE = "1";
	resetConfigCache();
	await resetJbcentralStateForTests();
	agent.configurePiRuntime(null);
	server = await createServer({ port: 0, host: "127.0.0.1" });
});

afterAll(async () => {
	await server.shutdown();
	sendSpy.mockRestore();
	publisherSpy.mockRestore();
	resetAnalyticsForTests();
	await resetJbcentralStateForTests();
	agent.configurePiRuntime(null);
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

const toolUpdate = (toolCallId: string, text: string): PiEvent => ({
	type: "tool_execution_update",
	toolCallId,
	toolName: "bash",
	args: {},
	partialResult: { content: [{ type: "text", text }] },
});
const toolEnd = (toolCallId: string): PiEvent => ({
	type: "tool_execution_end",
	toolCallId,
	toolName: "bash",
	result: { content: [] },
	isError: false,
});

function emit(event: PiEvent): void {
	if (!publish) throw new Error("the host installed no session publisher");
	publish({ sessionId: SESSION, event }, "conflation-workspace");
}

function toolFrames(frames: readonly { text: string }[], toolCallId: string): string[] {
	return frames.flatMap(({ text }) => {
		const frame = JSON.parse(text) as { channel?: string; data?: SessionEventPayload };
		const event = frame.data?.event;
		if (frame.channel !== WS_CHANNELS.piEvent || !event || !("toolCallId" in event)) return [];
		if (event.toolCallId !== toolCallId) return [];
		if (event.type === "tool_execution_update") {
			return [(event.partialResult as { content: { text: string }[] }).content[0]?.text ?? ""];
		}
		return [event.type];
	});
}

test("a backpressured socket gets only the newest stream snapshot, even when nothing follows it", async () => {
	const healthy = new WebSocket(
		`ws://127.0.0.1:${server.port}/ws?client=healthy&protocol=${PROTOCOL_VERSION}`,
	);
	const healthyFrames: { text: string }[] = [];
	const replies = new Set<string>();
	healthy.addEventListener("message", (event) => {
		const text = String(event.data);
		const frame = JSON.parse(text) as { id?: string; channel?: string };
		if (frame.id) replies.add(frame.id);
		if (frame.channel === WS_CHANNELS.piEvent) healthyFrames.push({ text });
	});
	await new Promise((resolve) => healthy.addEventListener("open", resolve, { once: true }));
	const stalled = await stalledClient(server.port, "stalled");
	let updates = 0;
	const backlog = async () => {
		for (let round = 0; round < 128; round += 1) {
			const id = `update-${updates}`;
			healthy.send(
				JSON.stringify({
					id,
					method: "settings.update",
					params: { config: { extensionSettings: { [BIG_SETTING]: { on: updates % 2 === 0 } } } },
				}),
			);
			updates += 1;
			await until(() => replies.has(id), `the reply to ${id}`);
		}
		await until(
			() => (sockets.get("stalled")?.getBufferedAmount() ?? 0) > 0,
			"a userspace backlog on the stalled socket",
		);
	};

	await backlog();
	for (const text of ["u1", "u2", "u3", "u4", "u5"]) emit(toolUpdate("t1", text));
	await until(
		() => toolFrames(healthyFrames, "t1").length === 5,
		"every snapshot on the healthy client",
	);
	expect(toolFrames(healthyFrames, "t1")).toEqual(["u1", "u2", "u3", "u4", "u5"]);

	stalled.socket.resume();
	await until(
		() => toolFrames(serverFrames(stalled.received()), "t1").length > 0,
		"the held snapshot on the stalled client once it drained",
	);
	await Bun.sleep(200);
	expect(toolFrames(serverFrames(stalled.received()), "t1")).toEqual(["u5"]);

	stalled.socket.pause();
	await backlog();
	emit(toolUpdate("t2", "v1"));
	emit(toolUpdate("t2", "v2"));
	emit(toolEnd("t2"));
	stalled.socket.resume();
	await until(
		() => toolFrames(serverFrames(stalled.received()), "t2").length >= 2,
		"the held snapshot and the end behind it",
	);
	await Bun.sleep(200);
	expect(toolFrames(serverFrames(stalled.received()), "t2")).toEqual(["v2", "tool_execution_end"]);
	expect(toolFrames(healthyFrames, "t2")).toEqual(["v1", "v2", "tool_execution_end"]);
	expect(serverFrames(stalled.received()).some((frame) => frame.opcode === CLOSE_OPCODE)).toBe(
		false,
	);
	stalled.socket.destroy();
	healthy.close();
}, 60_000);
