import { beforeEach, describe, expect, test } from "bun:test";
import type { SessionState } from "@thinkrail/contracts";
import {
	type AttentionNotificationEngine,
	createAttentionNotificationEngine,
	type TimerHandle,
} from "./attentionNotificationEngine";
import { type AttentionObserver, createAttentionObserver } from "./attentionObserver";
import { type AttentionCandidate, isLit } from "./detectAttention";
import type { NotificationSpec } from "./formatNotification";
import type { NotificationPermissionState } from "./webNotifications";

function scheduler() {
	let nextId = 1;
	const timers = new Map<number, () => void>();
	return {
		schedule(callback: () => void): TimerHandle {
			const id = nextId++;
			timers.set(id, callback);
			return id;
		},
		cancel(handle: TimerHandle) {
			timers.delete(handle as number);
		},
		run() {
			const callbacks = [...timers.values()];
			timers.clear();
			for (const callback of callbacks) callback();
		},
	};
}

function idle(): SessionState {
	return {
		execution: "idle",
		runId: null,
		needsInput: null,
		completion: null,
		completionUnread: false,
		queuedCount: 0,
	};
}
const question: SessionState = { ...idle(), needsInput: { interactionId: "i", kind: "question" } };
const finished: SessionState = {
	...idle(),
	completion: { completionId: "c", outcome: "succeeded" },
	completionUnread: true,
};

function cand(sessionId: string, state: SessionState): AttentionCandidate {
	return { sessionId, workspaceId: "w1", worktreeName: sessionId, state };
}

/**
 * Exercises the real observer + engine composition (everything the Shell hook wires, minus the DOM
 * and the store read). A mutable `candidates` array stands in for the store's session-state snapshot.
 */
describe("observer + engine pipeline", () => {
	let emitted: NotificationSpec[];
	let permissionNeeded: number;
	let clock: ReturnType<typeof scheduler>;
	let focused: boolean;
	let enabled: boolean;
	let permission: NotificationPermissionState;
	let candidates: AttentionCandidate[];
	let generation: number;
	let observer: AttentionObserver;
	let engine: AttentionNotificationEngine;

	function observe() {
		observer.observe({ snapshotInstalled: true, connectionGeneration: generation, candidates });
	}

	beforeEach(() => {
		emitted = [];
		permissionNeeded = 0;
		clock = scheduler();
		focused = false;
		enabled = true;
		permission = "granted";
		candidates = [];
		generation = 1;
		engine = createAttentionNotificationEngine({
			windowMs: 2000,
			isEnabled: () => enabled,
			permission: () => permission,
			isWindowFocused: () => focused,
			isStillLit: (id) => {
				const state = candidates.find((c) => c.sessionId === id)?.state;
				return state ? isLit(state) : false;
			},
			emit: (spec) => emitted.push(spec),
			onPermissionNeeded: () => {
				permissionNeeded++;
			},
			schedule: clock.schedule,
			cancel: clock.cancel,
		});
		observer = createAttentionObserver((event) => engine.enqueue(event));
	});

	test("prime then a rising edge yields one chat notification", () => {
		candidates = [cand("s1", idle())];
		observe(); // prime
		candidates = [cand("s1", question)];
		observe(); // rising edge → enqueue
		clock.run();
		expect(emitted).toHaveLength(1);
		expect(emitted[0]?.title).toBe("ThinkRail");
		expect(emitted[0]?.body).toBe("s1 · Waiting for your input");
		expect(emitted[0]?.target).toEqual({ kind: "chat", workspaceId: "w1", sessionId: "s1" });
	});

	test("two sessions lighting in one window aggregate", () => {
		observe(); // prime empty
		candidates = [cand("s1", question), cand("s2", finished)];
		observe();
		clock.run();
		expect(emitted).toHaveLength(1);
		expect(emitted[0]?.body).toBe("2 worktrees need your attention");
		expect(emitted[0]?.target).toEqual({ kind: "app" });
	});

	test("a session answered before the window flush is dropped", () => {
		observe(); // prime empty
		candidates = [cand("s1", question)];
		observe(); // enqueue s1
		candidates = [cand("s1", idle())]; // user answered before flush
		observe();
		clock.run();
		expect(emitted).toHaveLength(0);
	});

	test("focus at flush suppresses the whole batch without asking permission", () => {
		observe();
		candidates = [cand("s1", question)];
		observe();
		focused = true;
		clock.run();
		expect(emitted).toHaveLength(0);
		expect(permissionNeeded).toBe(0);
	});

	test("missing permission asks once for a multi-session batch", () => {
		permission = "default";
		observe();
		candidates = [cand("s1", question), cand("s2", question)];
		observe();
		clock.run();
		expect(emitted).toHaveLength(0);
		expect(permissionNeeded).toBe(1);
	});

	test("a reconnect re-primes so an already-lit session never re-notifies", () => {
		candidates = [cand("s1", question)];
		observe(); // prime with s1 already lit → no enqueue
		clock.run();
		expect(emitted).toHaveLength(0);
		// reconnect: fresh snapshot, s1 still lit
		generation = 2;
		candidates = [cand("s1", question)];
		observe();
		clock.run();
		expect(emitted).toHaveLength(0);
	});

	test("a disabled toggle suppresses the batch and asks nothing", () => {
		enabled = false;
		observe();
		candidates = [cand("s1", question)];
		observe();
		clock.run();
		expect(emitted).toHaveLength(0);
		expect(permissionNeeded).toBe(0);
	});

	test("sequential edges across windows each notify", () => {
		observe(); // prime empty
		candidates = [cand("s1", question)];
		observe();
		clock.run();
		expect(emitted).toHaveLength(1);
		// s1 answered, s2 lights later
		candidates = [cand("s1", idle()), cand("s2", question)];
		observe();
		clock.run();
		expect(emitted).toHaveLength(2);
		expect(emitted[1]?.target).toEqual({ kind: "chat", workspaceId: "w1", sessionId: "s2" });
	});
});
