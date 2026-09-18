import { expect, test } from "bun:test";
import type { AdditionalAnalyticsCapture, AdditionalAnalyticsEvent } from "../analytics";
import { type TaskGroupObservation, TaskObservation } from "./taskAnalytics";

function group(done: boolean, id = "group"): TaskGroupObservation {
	return {
		id,
		done,
		completedItems: new Set(done ? ["item"] : []),
		openItems: new Set(done ? [] : ["item"]),
		properties: { change_evidence: "none", verification_recorded: "no" },
	};
}

function fixture() {
	const events: AdditionalAnalyticsEvent[] = [];
	let capture: AdditionalAnalyticsCapture | null = (event) => events.push(event);
	let groups = [group(false)];
	let reads = 0;
	const observer = new TaskObservation(
		() => capture,
		() => {
			reads += 1;
			return groups;
		},
	);
	return {
		events,
		observer,
		setGroups(value: TaskGroupObservation[]) {
			groups = value;
		},
		revoke() {
			capture = null;
			observer.clear();
		},
		grant() {
			capture = (event) => events.push(event);
		},
		reads: () => reads,
	};
}

test("only a nonempty existing group's actual item completion counts, once after reconciliation", async () => {
	const f = fixture();
	f.observer.toolStarted("workspace", "session", {
		type: "tool_execution_start",
		toolCallId: "call",
		toolName: "todo_update",
		args: {},
	});
	const finish = f.observer.toolFinished("session", {
		type: "tool_execution_end",
		toolCallId: "call",
		toolName: "todo_update",
		result: {},
		isError: false,
	});
	f.setGroups([
		{ ...group(true), properties: { change_evidence: "both", verification_recorded: "yes" } },
	]);
	expect(f.events).toEqual([]);
	await finish();
	await finish();
	await f.observer.begin("workspace", "session")();
	expect(f.events).toEqual([
		{ name: "task_completed", params: { change_evidence: "both", verification_recorded: "yes" } },
	]);
});

test("pre-existing completed groups, fresh completed groups, removals, and loose items never count", async () => {
	const f = fixture();
	f.setGroups([group(true)]);
	await f.observer.begin("workspace", "session")();
	f.setGroups([]);
	const created = f.observer.begin("workspace", "session");
	f.setGroups([group(true)]);
	await created();
	f.setGroups([group(false)]);
	const removed = f.observer.begin("workspace", "session");
	f.setGroups([{ ...group(true), completedItems: new Set(["already-done-item"]) }]);
	await removed();
	f.setGroups([]);
	await f.observer.begin("workspace", "session")();
	expect(f.events).toEqual([]);
});

test("overlapping observations deduplicate completion; a real reopen allows the next completion", async () => {
	const f = fixture();
	const first = f.observer.begin("workspace", "session");
	const second = f.observer.begin("workspace", "session");
	f.setGroups([group(true)]);
	await Promise.all([first(), second()]);
	expect(f.events).toHaveLength(1);
	f.setGroups([group(false)]);
	const redone = f.observer.begin("workspace", "session");
	f.setGroups([group(true)]);
	await redone();
	expect(f.events).toHaveLength(2);
});

test("tool reads, failed writes, removals, and initial hydration do not emit completion", async () => {
	const f = fixture();
	for (const toolName of ["todo_list", "todo_remove", "read"]) {
		f.observer.toolStarted("workspace", "session", {
			type: "tool_execution_start",
			toolCallId: "call",
			toolName,
			args: {},
		});
		await f.observer.toolFinished("session", {
			type: "tool_execution_end",
			toolCallId: "call",
			toolName,
			result: {},
			isError: false,
		})();
	}
	expect(f.reads()).toBe(0);
	f.observer.toolStarted("workspace", "session", {
		type: "tool_execution_start",
		toolCallId: "call",
		toolName: "todo_update",
		args: {},
	});
	f.setGroups([group(true)]);
	await f.observer.toolFinished("session", {
		type: "tool_execution_end",
		toolCallId: "call",
		toolName: "todo_update",
		result: {},
		isError: true,
	})();
	expect(f.events).toEqual([]);
});

test("off collects nothing and async completion from a revoked grant never reads or replays", async () => {
	const f = fixture();
	const old = f.observer.begin("workspace", "session");
	f.revoke();
	const beforeConsent = f.observer.begin("workspace", "session");
	expect(f.reads()).toBe(1);
	f.grant();
	f.setGroups([group(true)]);
	await old();
	await beforeConsent();
	expect(f.reads()).toBe(1);
	expect(f.events).toEqual([]);
});

test("session deletion while completion waits drops the snapshot without a late plan read", async () => {
	const f = fixture();
	const finish = f.observer.begin("workspace", "session");
	f.setGroups([group(true)]);
	const waiting = finish();
	f.observer.forget("session");
	await waiting;
	expect(f.events).toEqual([]);
	expect(f.reads()).toBe(1);
	f.setGroups([group(false)]);
	const next = f.observer.begin("workspace", "session");
	f.setGroups([group(true)]);
	await next();
	expect(f.events).toHaveLength(1);
});

test("failed plan reads are observational only", async () => {
	const observer = new TaskObservation(
		() => () => {},
		() => {
			throw new Error("read failed");
		},
	);
	await expect(observer.begin("workspace", "session")()).resolves.toBeUndefined();
});
