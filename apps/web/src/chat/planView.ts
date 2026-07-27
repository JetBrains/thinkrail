import type { TodoGroupItem, TodoItem, TodoPlan } from "@thinkrail/contracts";
import type { AskState } from "./askState";

// Pure derivations for the chat TODO plan's rendering (SPEC §Chat TODO plan): the group-as-task view
// (group = one user ask, items = its steps) and the glance state ("is the system working or waiting on
// me?"). Presentational modules consume these via props; nothing here touches the store or transport.

/**
 * A group's derived task status — **a mirror of `pi-todos/core`'s `groupStatus`** (the web app may
 * import `@thinkrail/contracts` only, never `pi-todos`), the same way the DTOs themselves mirror the
 * extension's model. Keep the two in step. Never stored, so it can't drift from the steps.
 */
export type TodoGroupStatus = "pending" | "active" | "done";

export function groupStatus(group: TodoGroupItem): TodoGroupStatus {
	if (group.todos.length > 0 && group.todos.every((t) => t.status === "done")) return "done";
	if (group.todos.some((t) => t.status === "in_progress")) return "active";
	return "pending";
}

/** done / total across a group's steps — the header badge ("2/3"). */
export function groupProgress(group: TodoGroupItem): { done: number; total: number } {
	return {
		done: group.todos.filter((t) => t.status === "done").length,
		total: group.todos.length,
	};
}

/** Every item across loose + groups, in display order. */
export function flatItems(plan: TodoPlan): TodoItem[] {
	return [...plan.todos, ...plan.groups.flatMap((g) => g.todos)];
}

/** done / total and the current in-progress item — the "what's happening now" glance. */
export function planSummary(plan: TodoPlan): {
	done: number;
	total: number;
	current: TodoItem | undefined;
} {
	const all = flatItems(plan);
	return {
		done: all.filter((t) => t.status === "done").length,
		total: all.length,
		current: all.find((t) => t.status === "in_progress"),
	};
}

/**
 * Whether the system is working or waiting on the user — the glance state that keeps an `in_progress`
 * item from lying when the agent has stopped. **Derived from session state, never stored**: the agent
 * sets nothing here, so it can't drift — any stop shows as waiting, whether or not the agent knew it
 * was stopping (a question, an error, or just the turn ending).
 */
export type PlanGlance = "working" | "waiting_question" | "waiting";

export function planGlance(isStreaming: boolean, askStates: Record<string, AskState>): PlanGlance {
	if (isStreaming) return "working";
	const awaiting = Object.values(askStates).some((s) => !s.answer && !s.superseded);
	return awaiting ? "waiting_question" : "waiting";
}
