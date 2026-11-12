import { expect, test } from "bun:test";
import { type OutboundSocket, type SlowConsumerError, sendOrClose } from "./socketSend";

function fakeSocket(outcome: number | Error, readyState: number = WebSocket.OPEN) {
	const socket = {
		readyState,
		closes: 0,
		sent: [] as string[],
		send(frame: string) {
			if (outcome instanceof Error) throw outcome;
			socket.sent.push(frame);
			return outcome;
		},
		getBufferedAmount: () => 300,
		close() {
			socket.closes += 1;
			socket.readyState = WebSocket.CLOSING;
		},
	} satisfies OutboundSocket & { closes: number; sent: string[] };
	return socket;
}

function collectWarnings() {
	const warnings: { message: string; error: SlowConsumerError }[] = [];
	return {
		warnings,
		warn: (message: string, error: SlowConsumerError) => warnings.push({ message, error }),
	};
}

test("a frame the socket accepts or buffers keeps the socket open", () => {
	for (const [status, outcome] of [
		[12, "delivered"],
		[-1, "backpressured"],
	] as const) {
		const socket = fakeSocket(status);
		const { warnings, warn } = collectWarnings();
		expect(sendOrClose(socket, "frame", "pi.event push", warn)).toBe(outcome);
		expect(socket.closes).toBe(0);
		expect(warnings).toEqual([]);
	}
});

test("a frame dropped past the buffer limit closes that socket with a coded warning", () => {
	const socket = fakeSocket(0);
	const { warnings, warn } = collectWarnings();
	expect(sendOrClose(socket, "frame", "pi.event push", warn)).toBe("dropped");
	expect(socket.closes).toBe(1);
	expect(warnings.map(({ message }) => message)).toEqual([
		"pi.event push dropped with 300 bytes buffered; closing the socket",
	]);
	expect(warnings[0]?.error.code).toBe("WS_SLOW_CONSUMER");
});

test("a socket that is already closing is closed again without a warning", () => {
	const socket = fakeSocket(0, WebSocket.CLOSING);
	const { warnings, warn } = collectWarnings();
	expect(sendOrClose(socket, "frame", "session.state push", warn)).toBe("dropped");
	expect(socket.closes).toBe(1);
	expect(warnings).toEqual([]);
});

test("a send that throws closes the socket", () => {
	const socket = fakeSocket(new Error("socket gone"));
	const { warnings, warn } = collectWarnings();
	expect(sendOrClose(socket, "frame", "settings.changed push", warn)).toBe("dropped");
	expect(socket.closes).toBe(1);
	expect(warnings).toEqual([]);
});
