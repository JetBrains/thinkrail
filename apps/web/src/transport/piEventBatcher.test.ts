import { expect, test } from "bun:test";
import type { PiEvent, SessionEventPayload, WsServerMessage } from "@thinkrail/contracts";
import { WS_CHANNELS } from "@thinkrail/contracts";
import { createPiEventBatcher, shouldFlushPiEventsBefore } from "./piEventBatcher";

const payload = (sessionId: string, type: PiEvent["type"]): SessionEventPayload => ({
	sessionId,
	event: { type } as PiEvent,
});

function manualScheduler() {
	let scheduled: (() => void) | null = null;
	return {
		schedule: (flush: () => void) => {
			scheduled = flush;
			return () => {
				if (scheduled === flush) scheduled = null;
			};
		},
		pending: () => scheduled,
	};
}

test("batches consecutive Pi events in exact arrival order", () => {
	const delivered: (readonly SessionEventPayload[])[] = [];
	const scheduler = manualScheduler();
	const batcher = createPiEventBatcher((events) => delivered.push(events), {
		schedule: scheduler.schedule,
	});
	const first = payload("a", "agent_start");
	const second = payload("b", "turn_start");

	batcher.enqueue(first);
	batcher.enqueue(second);
	expect(delivered).toEqual([]);
	expect(scheduler.pending()).not.toBeNull();
	scheduler.pending()?.();

	expect(delivered).toEqual([[first, second]]);
	expect(scheduler.pending()).toBeNull();
});

test("the queue ceiling forces a flush and disposal drops pending work", () => {
	const delivered: (readonly SessionEventPayload[])[] = [];
	const scheduler = manualScheduler();
	const batcher = createPiEventBatcher((events) => delivered.push(events), {
		maxBatchSize: 2,
		schedule: scheduler.schedule,
	});
	const first = payload("a", "agent_start");
	const second = payload("a", "turn_start");
	const third = payload("a", "agent_end");

	batcher.enqueue(first);
	batcher.enqueue(second);
	expect(delivered).toEqual([[first, second]]);
	expect(scheduler.pending()).toBeNull();

	batcher.enqueue(third);
	expect(scheduler.pending()).not.toBeNull();
	batcher.dispose();
	scheduler.pending()?.();
	batcher.enqueue(first);
	batcher.flush();

	expect(delivered).toEqual([[first, second]]);
});

test("responses and non-Pi pushes form dispatch barriers", () => {
	const piPush = {
		channel: WS_CHANNELS.piEvent,
		data: payload("a", "agent_start"),
	} as WsServerMessage;
	const otherPush = {
		channel: WS_CHANNELS.workspaceFsChanged,
		data: {},
	} as WsServerMessage;
	const response = { id: "r1", ok: true, result: {} } as WsServerMessage;

	expect(shouldFlushPiEventsBefore(piPush)).toBe(false);
	expect(shouldFlushPiEventsBefore(otherPush)).toBe(true);
	expect(shouldFlushPiEventsBefore(response)).toBe(true);
});
