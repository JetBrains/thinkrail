import { expect, test } from "bun:test";
import type { PiEvent, TodoItem, TodoPlan } from "@thinkrail/contracts";
import { PLAN_SUMMARY_GENERATION_PROTOCOL_VERSION } from "@thinkrail/contracts";
import { supportsPlanSummaryGeneration } from "../transport";
import {
	planIsCompleteWithoutSummary,
	shouldRefreshTodos,
	signalTodoRefetch,
	subscribeTodoRefetch,
} from "./useChatTodos";

const item = (status: TodoItem["status"]): TodoItem => ({
	id: `t_${status}_${Math.random()}`,
	title: "step",
	status,
	origin: "agent",
	createdAt: "",
	updatedAt: "",
});
const plan = (over: Partial<TodoPlan>): TodoPlan => ({ todos: [], groups: [], ...over });

test("TODO refreshes follow tool completion and final settlement, not attempt-level agent_end", () => {
	expect(shouldRefreshTodos({ type: "tool_execution_end" } as PiEvent)).toBe(true);
	expect(shouldRefreshTodos({ type: "agent_settled", terminal: null })).toBe(true);
	expect(shouldRefreshTodos({ type: "agent_end", messages: [], willRetry: false } as PiEvent)).toBe(
		false,
	);
});

test("auto-summary is eligible only when every step is done and no summary exists", () => {
	expect(planIsCompleteWithoutSummary(plan({ todos: [item("done")] }))).toBe(true);
	expect(
		planIsCompleteWithoutSummary(
			plan({ groups: [{ id: "g", title: "T", todos: [item("done"), item("done")] }] }),
		),
	).toBe(true);
	// An open step, a lingering summary, or an empty plan are all ineligible.
	expect(planIsCompleteWithoutSummary(plan({ todos: [item("done"), item("pending")] }))).toBe(
		false,
	);
	expect(planIsCompleteWithoutSummary(plan({ todos: [item("done")], summary: "already" }))).toBe(
		false,
	);
	expect(planIsCompleteWithoutSummary(plan({}))).toBe(false);
});

test("a completed plan requests a draft only from a host that advertises the v69 capability", () => {
	const completed = plan({ todos: [item("done")] });
	const wouldRequest = (pv: number | null) =>
		planIsCompleteWithoutSummary(completed) && supportsPlanSummaryGeneration(pv);
	expect(wouldRequest(PLAN_SUMMARY_GENERATION_PROTOCOL_VERSION)).toBe(true);
	expect(wouldRequest(PLAN_SUMMARY_GENERATION_PROTOCOL_VERSION - 1)).toBe(false);
	expect(wouldRequest(null)).toBe(false);
});

test("the refetch bus fans out to every subscriber for a chat key and isolates sibling chats", () => {
	const calls: string[] = [];
	const railA = () => calls.push("rail:A");
	const pageA = () => calls.push("page:A");
	const railB = () => calls.push("rail:B");
	const unsubscribeRailA = subscribeTodoRefetch("A", railA);
	const unsubscribePageA = subscribeTodoRefetch("A", pageA);
	const unsubscribeRailB = subscribeTodoRefetch("B", railB);

	signalTodoRefetch("A");
	expect(calls.sort()).toEqual(["page:A", "rail:A"]);

	calls.length = 0;
	signalTodoRefetch("B");
	expect(calls).toEqual(["rail:B"]);

	calls.length = 0;
	unsubscribePageA();
	signalTodoRefetch("A");
	expect(calls).toEqual(["rail:A"]);

	unsubscribeRailA();
	unsubscribeRailB();
	calls.length = 0;
	signalTodoRefetch("A");
	signalTodoRefetch("B");
	expect(calls).toEqual([]);
});

test("an unknown key signal is a no-op \u2014 safe to fire before any subscriber mounts", () => {
	expect(() => signalTodoRefetch("never-subscribed")).not.toThrow();
});

test("a listener added mid-signal does NOT run for the signal that was already in flight", () => {
	// This locks the fan-out contract: a mount that races with a sibling's write doesn't accidentally
	// run against the write that just finished; it will see the NEXT signal, not this one. Prevents
	// a double-refetch loop if a hook mount coincides with an in-flight add.
	const calls: string[] = [];
	const late: (() => void)[] = [];
	const early = () => {
		calls.push("early");
		// Simulate a React render-time subscription that happens during the same flush as the signal.
		late.push(subscribeTodoRefetch("K", () => calls.push("late")));
	};
	const unsubscribeEarly = subscribeTodoRefetch("K", early);
	signalTodoRefetch("K");
	expect(calls).toEqual(["early"]);

	calls.length = 0;
	signalTodoRefetch("K");
	expect(calls.sort()).toEqual(["early", "late"]);

	unsubscribeEarly();
	for (const u of late) u();
});

test("the same listener subscribed twice is only invoked once per signal (Set-based bus)", () => {
	// The bus is backed by a Set, so a defensive duplicate `subscribe` never double-fires. Protects a
	// StrictMode double-mount from a thundering herd of refetches.
	let calls = 0;
	const listener = () => {
		calls += 1;
	};
	const a = subscribeTodoRefetch("K2", listener);
	const b = subscribeTodoRefetch("K2", listener);
	signalTodoRefetch("K2");
	expect(calls).toBe(1);
	a();
	b();
});

test("an unsubscribe cleans up the key's bucket \u2014 later signals cost nothing and don't fire stale closures", () => {
	const sink: string[] = [];
	const drop = subscribeTodoRefetch("K3", () => sink.push("x"));
	drop();
	signalTodoRefetch("K3");
	signalTodoRefetch("K3");
	expect(sink).toEqual([]);
	// Idempotent unsubscribe: a double-drop (StrictMode cleanup → re-cleanup) is harmless.
	expect(() => drop()).not.toThrow();
});

test("one listener's throw does not swallow its siblings' signal \u2014 the bus keeps delivering", () => {
	// Sibling isolation: when a listener synchronously throws (unmount race, stale closure) the
	// other hooks still refetch. `signalTodoRefetch` wraps each listener in try/catch and logs the
	// error, so neither the signal nor sibling delivery is observable from the outside.
	const survivors: string[] = [];
	const a = subscribeTodoRefetch("K4", () => {
		throw new Error("first listener blew up");
	});
	const b = subscribeTodoRefetch("K4", () => survivors.push("b"));
	const originalError = console.error;
	console.error = () => {};
	try {
		expect(() => signalTodoRefetch("K4")).not.toThrow();
		expect(survivors).toEqual(["b"]);
	} finally {
		console.error = originalError;
	}
	a();
	b();
});
