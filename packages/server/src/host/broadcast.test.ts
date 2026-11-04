import { describe, expect, test } from "bun:test";
import { broadcastFrame } from "./broadcast";

function target(sendStatus: number, subscribed = true) {
	const sent: string[] = [];
	let closed = false;
	return {
		sent,
		get closed() {
			return closed;
		},
		send(frame: string): number {
			sent.push(frame);
			return sendStatus;
		},
		close(): void {
			closed = true;
		},
		isSubscribed(_channel: string): boolean {
			return subscribed;
		},
	};
}

describe("broadcastFrame", () => {
	test("delivers the framed channel payload to every socket", () => {
		const fast = target(3);
		const slow = target(1);
		broadcastFrame([fast, slow], "piEvent", { type: "agent_settled" });
		const frame = JSON.stringify({ channel: "piEvent", data: { type: "agent_settled" } });
		expect(fast.sent).toEqual([frame]);
		expect(slow.sent).toEqual([frame]);
		expect(fast.closed).toBe(false);
		expect(slow.closed).toBe(false);
	});

	test("closes a backpressured consumer so it reconnects and resyncs (#1179)", () => {
		const dropped = target(-1);
		const healthy = target(1);
		broadcastFrame([dropped, healthy], "piEvent", { type: "message_end" });
		expect(dropped.closed).toBe(true);
		expect(healthy.closed).toBe(false);
	});

	test("closes an unavailable consumer instead of losing the frame silently", () => {
		const gone = target(0);
		broadcastFrame([gone], "sessionState", { id: "s1" });
		expect(gone.closed).toBe(true);
	});

	test("skips a socket that did not subscribe — protocol-gated channels stay gated", () => {
		const older = target(1, false);
		const newer = target(1, true);
		broadcastFrame([older, newer], "fontsChanged", {});
		expect(older.sent).toEqual([]);
		expect(older.closed).toBe(false);
		expect(newer.sent).toHaveLength(1);
	});
});
