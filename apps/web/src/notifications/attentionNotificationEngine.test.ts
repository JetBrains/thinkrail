import { beforeEach, describe, expect, test } from "bun:test";
import {
	type AttentionNotificationEngine,
	type AttentionNotificationEngineDeps,
	createAttentionNotificationEngine,
	type TimerHandle,
} from "./attentionNotificationEngine";
import type { AttentionEvent, NotificationSpec } from "./formatNotification";
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
		get size() {
			return timers.size;
		},
	};
}

function event(overrides: Partial<AttentionEvent> = {}): AttentionEvent {
	return {
		sessionId: "s1",
		workspaceId: "w1",
		worktreeName: "branch",
		reason: { kind: "needs-input" },
		...overrides,
	};
}

describe("createAttentionNotificationEngine", () => {
	let emitted: NotificationSpec[];
	let permissionNeeded: number;
	let clock: ReturnType<typeof scheduler>;
	let enabled: boolean;
	let permission: NotificationPermissionState;
	let focused: boolean;
	let lit: Set<string>;
	let engine: AttentionNotificationEngine;

	function build(overrides: Partial<AttentionNotificationEngineDeps> = {}) {
		return createAttentionNotificationEngine({
			windowMs: 2000,
			isEnabled: () => enabled,
			permission: () => permission,
			isWindowFocused: () => focused,
			isStillLit: (id) => lit.has(id),
			emit: (spec) => emitted.push(spec),
			onPermissionNeeded: () => {
				permissionNeeded++;
			},
			schedule: clock.schedule,
			cancel: clock.cancel,
			...overrides,
		});
	}

	beforeEach(() => {
		emitted = [];
		permissionNeeded = 0;
		clock = scheduler();
		enabled = true;
		permission = "granted";
		focused = false;
		lit = new Set(["s1", "s2", "s3"]);
		engine = build();
	});

	test("coalesces a burst into one flush and emits a single notification", () => {
		engine.enqueue(event({ sessionId: "s1" }));
		engine.enqueue(event({ sessionId: "s1" }));
		expect(clock.size).toBe(1); // one window timer, not one per event
		clock.run();
		expect(emitted).toHaveLength(1);
		expect(emitted[0]?.target).toEqual({ kind: "chat", workspaceId: "w1", sessionId: "s1" });
	});

	test("multiple sessions aggregate", () => {
		engine.enqueue(event({ sessionId: "s1" }));
		engine.enqueue(event({ sessionId: "s2" }));
		clock.run();
		expect(emitted[0]?.target).toEqual({ kind: "app" });
		expect(emitted[0]?.body).toBe("2 worktrees need attention");
	});

	test("window focused suppresses the whole batch", () => {
		engine.enqueue(event());
		focused = true;
		clock.run();
		expect(emitted).toHaveLength(0);
		expect(permissionNeeded).toBe(0);
	});

	test("disabled master toggle suppresses", () => {
		engine.enqueue(event());
		enabled = false;
		clock.run();
		expect(emitted).toHaveLength(0);
		expect(permissionNeeded).toBe(0);
	});

	test("already-answered sessions are dropped at flush", () => {
		engine.enqueue(event({ sessionId: "s1" }));
		engine.enqueue(event({ sessionId: "s2" }));
		lit.delete("s1");
		clock.run();
		expect(emitted[0]?.target).toEqual({ kind: "chat", workspaceId: "w1", sessionId: "s2" });
	});

	test("no surviving events ⇒ nothing emitted", () => {
		engine.enqueue(event({ sessionId: "s1" }));
		lit.clear();
		clock.run();
		expect(emitted).toHaveLength(0);
	});

	test("missing permission asks instead of emitting", () => {
		permission = "default";
		engine.enqueue(event());
		clock.run();
		expect(emitted).toHaveLength(0);
		expect(permissionNeeded).toBe(1);
	});

	test("dispose cancels a pending window", () => {
		engine.enqueue(event());
		engine.dispose();
		clock.run();
		expect(emitted).toHaveLength(0);
	});
});
