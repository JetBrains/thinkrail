import { expect, test } from "bun:test";
import {
	type OutboundSocket,
	SLOW_CONSUMER_DRAIN_DEADLINE_MS,
	type SlowConsumerError,
	sendOrQuarantine,
	settleSlowConsumer,
} from "./socketSend";

interface FakeSocket extends OutboundSocket {
	readyState: number;
	buffered: number;
	closes: number;
	terminations: number;
	sent: string[];
}

function fakeSocket(outcome: number | Error, readyState: number = WebSocket.OPEN): FakeSocket {
	const socket: FakeSocket = {
		readyState,
		data: {},
		buffered: 300,
		closes: 0,
		terminations: 0,
		sent: [],
		send(frame) {
			if (outcome instanceof Error) throw outcome;
			socket.sent.push(frame);
			return outcome;
		},
		getBufferedAmount: () => socket.buffered,
		close() {
			socket.closes += 1;
		},
		terminate() {
			socket.terminations += 1;
		},
	};
	return socket;
}

function collectWarnings() {
	const warnings: { message: string; error: SlowConsumerError }[] = [];
	const warn = (message: string, error: SlowConsumerError) => warnings.push({ message, error });
	return { warnings, warn };
}

test("a frame the socket accepts or buffers keeps the socket open", () => {
	for (const [status, outcome] of [
		[12, "delivered"],
		[-1, "backpressured"],
	] as const) {
		const socket = fakeSocket(status);
		const { warnings, warn } = collectWarnings();
		expect(sendOrQuarantine(socket, "frame", "pi.event push", warn)).toBe(outcome);
		expect(settleSlowConsumer(socket)).toBe("healthy");
		expect(socket.closes).toBe(0);
		expect(warnings).toEqual([]);
	}
});

test("a frame dropped past the buffer limit quarantines the socket with one coded warning", () => {
	const socket = fakeSocket(0);
	const { warnings, warn } = collectWarnings();
	expect(sendOrQuarantine(socket, "frame", "pi.event push", warn, 1_000)).toBe("dropped");
	expect(sendOrQuarantine(socket, "later", "session.state push", warn, 1_001)).toBe("dropped");
	expect(socket.sent).toEqual(["frame"]);
	expect(socket.closes).toBe(0);
	expect(socket.data.slowSince).toBe(1_000);
	expect(warnings.map(({ message }) => message)).toEqual([
		"pi.event push dropped with 300 bytes buffered; closing the socket once it drains",
	]);
	expect(warnings[0]?.error.code).toBe("WS_SLOW_CONSUMER");
});

test("a quarantined socket closes once drained and is terminated past the deadline", () => {
	const { warn } = collectWarnings();
	const draining = fakeSocket(0);
	sendOrQuarantine(draining, "frame", "pi.event push", warn, 0);
	expect(settleSlowConsumer(draining, SLOW_CONSUMER_DRAIN_DEADLINE_MS - 1)).toBe("draining");
	draining.buffered = 0;
	expect(settleSlowConsumer(draining, SLOW_CONSUMER_DRAIN_DEADLINE_MS - 1)).toBe("closed");
	expect([draining.closes, draining.terminations]).toEqual([1, 0]);

	const stuck = fakeSocket(0);
	sendOrQuarantine(stuck, "frame", "pi.event push", warn, 0);
	expect(settleSlowConsumer(stuck, SLOW_CONSUMER_DRAIN_DEADLINE_MS)).toBe("closed");
	expect([stuck.closes, stuck.terminations]).toEqual([0, 1]);
});

test("a socket that is already closing or throws is closed without a warning", () => {
	for (const socket of [fakeSocket(0, WebSocket.CLOSING), fakeSocket(new Error("socket gone"))]) {
		const { warnings, warn } = collectWarnings();
		expect(sendOrQuarantine(socket, "frame", "settings.changed push", warn)).toBe("dropped");
		expect(socket.closes).toBe(1);
		expect(socket.data.slowSince).toBeUndefined();
		expect(warnings).toEqual([]);
	}
});
