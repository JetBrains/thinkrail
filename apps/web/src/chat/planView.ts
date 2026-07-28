import type {
	AskUserQuestionResult,
	TodoGroupItem,
	TodoItem,
	TodoPlan,
} from "@thinkrail/contracts";
import { type AskState, deriveAskStates } from "./askState";
import type { ChatTurn } from "./types";

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

/** Every item in display order: the groups (the agent's tasks) first, then the loose lane (the user's
 * own adds) **last** — **a mirror of `pi-todos/core`'s `flatItems`** (this app may import `contracts`
 * only), the same way `groupStatus` mirrors the extension's helper. Keep the two in step. */
export function flatItems(plan: TodoPlan): TodoItem[] {
	return [...plan.groups.flatMap((g) => g.todos), ...plan.todos];
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

/** A session runtime's glance, composing {@link deriveAskStates} + {@link planGlance} — the one place
 * that derives it straight from a runtime, for callers (e.g. the add-nudge) that don't already hold the
 * ask states the way `ChatView` does. */
export function sessionGlance(rt: {
	isStreaming: boolean;
	turns: ChatTurn[];
	askAnswers: Record<string, AskUserQuestionResult>;
}): PlanGlance {
	return planGlance(rt.isStreaming, deriveAskStates(rt.turns, rt.askAnswers));
}

/**
 * Should a user's just-added item **wake** the agent? No while it's `waiting_question` — an
 * `ask_user_question` is pending, so waking it would make it go work the new item and forget to come
 * back to its own question; the item just queues at the end (loose) and is picked up on the agent's next
 * natural turn (when the user answers, or a later idle nudge). Yes when `working` (a `followUp` rides the
 * live turn) or plain `waiting`/idle (a `prompt` wakes it) — "disturb it only when it isn't waiting."
 */
export function shouldNudgeOnAdd(glance: PlanGlance): boolean {
	return glance !== "waiting_question";
}
