import { expect, test } from "bun:test";
import type { PiEvent, SessionEventPayload } from "@thinkrail/contracts";
import { HeldSnapshots, snapshotKey } from "./heldSnapshots";
import type { SendOutcome } from "./socketSend";

const partial = { role: "assistant", content: [], timestamp: 0 } as never;
const message = (type: string, extra: object = {}): PiEvent =>
	({
		type: "message_update",
		message: partial,
		assistantMessageEvent: { type, ...extra },
	}) as unknown as PiEvent;
const toolUpdate = (toolCallId: string, text: string): PiEvent => ({
	type: "tool_execution_update",
	toolCallId,
	toolName: "bash",
	args: {},
	partialResult: { content: [{ type: "text", text }] },
});
const event = (sessionId: string, piEvent: PiEvent): SessionEventPayload => ({
	sessionId,
	event: piEvent,
});

function fakeSocket(outcomes: SendOutcome[] = []) {
	const socket = {
		buffered: 0,
		sent: [] as string[],
		getBufferedAmount: () => socket.buffered,
		send(frame: string): SendOutcome {
			socket.sent.push(frame);
			return outcomes.shift() ?? "delivered";
		},
	};
	return socket;
}

test("only partial-carrying message updates and tool updates are replaceable snapshots", () => {
	for (const type of [
		"start",
		"text_start",
		"text_delta",
		"text_end",
		"thinking_start",
		"thinking_delta",
		"thinking_end",
		"toolcall_start",
		"toolcall_delta",
		"toolcall_end",
	]) {
		expect(snapshotKey(event("s", message(type, { partial })))).toBe(
			JSON.stringify(["s", "message"]),
		);
	}
	expect(snapshotKey(event("s", toolUpdate("t1", "x")))).toBe(JSON.stringify(["s", "tool", "t1"]));
	for (const piEvent of [
		message("done", { message: partial }),
		message("error", { error: partial }),
		{ type: "bash_execution_update", delta: "x" },
		{ type: "message_end", message: partial },
		{ type: "tool_execution_end", toolCallId: "t1", toolName: "bash", result: {}, isError: false },
		{ type: "agent_settled", terminal: null },
		{ type: "queue_update", steering: [], followUp: [] },
	] as PiEvent[]) {
		expect(snapshotKey(event("s", piEvent))).toBeUndefined();
	}
});

test("an empty buffer sends every snapshot at once", () => {
	const socket = fakeSocket();
	const held = new HeldSnapshots(socket);
	expect(held.deliver(event("s", toolUpdate("t1", "a")), "a")).toBe("delivered");
	expect(held.deliver(event("s", toolUpdate("t1", "b")), "b")).toBe("delivered");
	expect(socket.sent).toEqual(["a", "b"]);
	expect(held.size).toBe(0);
});

test("a backlog keeps only the newest snapshot per stream and sends it once the buffer is empty", () => {
	const socket = fakeSocket();
	const held = new HeldSnapshots(socket);
	socket.buffered = 1;
	for (const frame of ["a1", "a2", "a3"]) held.deliver(event("s", toolUpdate("t1", frame)), frame);
	held.deliver(event("s", toolUpdate("t2", "b1")), "b1");
	held.deliver(event("other", toolUpdate("t1", "c1")), "c1");
	held.deliver(event("s", message("text_delta", { partial })), "m1");
	expect(socket.sent).toEqual([]);
	expect(held.drain()).toBe("waiting");
	socket.buffered = 0;
	expect(held.drain()).toBe("flushed");
	expect(socket.sent).toEqual(["a3", "b1", "c1", "m1"]);
	expect(held.drain()).toBe("idle");
});

test("a re-held stream moves behind the snapshots that arrived after its older one", () => {
	const socket = fakeSocket();
	const held = new HeldSnapshots(socket);
	socket.buffered = 1;
	held.deliver(event("s", message("text_delta", { partial })), "m1");
	held.deliver(event("s", toolUpdate("t1", "a")), "t1");
	held.deliver(event("s", message("text_delta", { partial })), "m2");
	socket.buffered = 0;
	held.drain();
	expect(socket.sent).toEqual(["t1", "m2"]);
});

test("an opportunistic flush stops at backpressure and keeps the unsent rest", () => {
	const socket = fakeSocket(["backpressured"]);
	const held = new HeldSnapshots(socket);
	socket.buffered = 1;
	held.deliver(event("s", toolUpdate("t1", "a")), "a");
	held.deliver(event("s", toolUpdate("t2", "b")), "b");
	socket.buffered = 0;
	expect(held.drain()).toBe("backpressured");
	expect(socket.sent).toEqual(["a"]);
	expect(held.size).toBe(1);
	expect(held.drain()).toBe("flushed");
	expect(socket.sent).toEqual(["a", "b"]);
});

test("any later frame of a session first sends that session's held snapshots, through backpressure", () => {
	const socket = fakeSocket(["backpressured", "backpressured"]);
	const held = new HeldSnapshots(socket);
	socket.buffered = 1;
	held.deliver(event("s", message("text_delta", { partial })), "m1");
	held.deliver(event("s", toolUpdate("t1", "a")), "t1");
	held.deliver(event("other", toolUpdate("t1", "x")), "x");
	const end: PiEvent = { type: "message_end", message: partial };
	expect(held.deliver(event("s", end), "end")).toBe("delivered");
	expect(socket.sent).toEqual(["m1", "t1", "end"]);
	expect(held.barrier("other")).toBe(true);
	expect(socket.sent).toEqual(["m1", "t1", "end", "x"]);
	expect(held.size).toBe(0);
});

test("a replaceable snapshot sent on an empty buffer goes after the session's older held ones", () => {
	const socket = fakeSocket();
	const held = new HeldSnapshots(socket);
	socket.buffered = 1;
	held.deliver(event("s", toolUpdate("t1", "a")), "a");
	socket.buffered = 0;
	held.deliver(event("s", toolUpdate("t2", "b")), "b");
	expect(socket.sent).toEqual(["a", "b"]);
});

test("a dropped send clears the socket's held snapshots and skips the frame behind it", () => {
	const socket = fakeSocket(["dropped"]);
	const held = new HeldSnapshots(socket);
	socket.buffered = 1;
	held.deliver(event("s", toolUpdate("t1", "a")), "a");
	held.deliver(event("other", toolUpdate("t1", "x")), "x");
	expect(held.deliver(event("s", { type: "agent_settled", terminal: null }), "settled")).toBe(
		"dropped",
	);
	expect(socket.sent).toEqual(["a"]);
	expect(held.size).toBe(0);
});

test("a deleted session's held snapshots are forgotten", () => {
	const socket = fakeSocket();
	const held = new HeldSnapshots(socket);
	socket.buffered = 1;
	held.deliver(event("s", toolUpdate("t1", "a")), "a");
	held.deliver(event("other", toolUpdate("t1", "x")), "x");
	held.forgetSession("s");
	socket.buffered = 0;
	held.drain();
	expect(socket.sent).toEqual(["x"]);
});
