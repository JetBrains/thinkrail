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

/** done / total across a group's steps — the header badge ("2/3"). */
export function groupProgress(group: TodoGroupItem): { done: number; total: number } {
	return {
		done: group.todos.filter((t) => t.status === "done").length,
		total: group.todos.length,
	};
}

/** Every item of a plan, flattened for counting and for finding the current step — groups first, the
 * user's loose lane last (the order the panel and the agent's text plan read in). Order is incidental to
 * this app's uses; where it is load-bearing is `pi-todos`, whose `replaceAll` uses it to decide which
 * `in_progress` survives. */
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
 * The header strip's live status — **the agent's state, decoupled from the checkboxes** (SPEC §Chat TODO
 * plan). The old strip only showed status through the `in_progress` step, so an agent that was
 * `waiting_question` with everything `done` read as "finished". Here the rule is on the glance:
 * - `working` / `waiting_question` → always `show` (the agent is doing / needs you, regardless of boxes);
 * - `waiting` (stopped, no pending question) → `show` only when open steps remain (stopped mid-plan =
 *   "Paused"); on a clean finish (all done / empty, idle) `show` is false — don't cry "paused".
 * `showLabel` hides the label only for `working` *with* a current step (its title conveys it); `title` is
 * the current step's title when there is one. Pure; the strip just renders this.
 */
export function stripStatus(
	glance: PlanGlance,
	summary: { done: number; total: number; current: TodoItem | undefined },
): { show: boolean; showLabel: boolean; title?: string } {
	const openLeft = summary.total - summary.done > 0;
	return {
		show: glance !== "waiting" || openLeft,
		showLabel: glance !== "working" || !summary.current,
		...(summary.current ? { title: summary.current.title } : {}),
	};
}

/**
 * The panel's status-ordered sections (SPEC §Chat TODO plan): the plan is read top-to-bottom as a
 * status flow — **in progress**, then **to do**, then **done** — while keeping the task groups whole.
 * `groups` are bucketed by their derived {@link groupStatus}; loose items (the user's own adds) by
 * their own `status`. Finished *steps* stay inline in their (active/pending) group — only fully-`done`
 * groups and `done` loose items land in `done`. Pure; `TodoList` just renders what this returns.
 */
export interface PlanSections {
	activeGroups: TodoGroupItem[];
	activeLoose: TodoItem[];
	pendingGroups: TodoGroupItem[];
	pendingLoose: TodoItem[];
	doneGroups: TodoGroupItem[];
	doneLoose: TodoItem[];
}

export function planSections(plan: TodoPlan): PlanSections {
	const s: PlanSections = {
		activeGroups: [],
		activeLoose: [],
		pendingGroups: [],
		pendingLoose: [],
		doneGroups: [],
		doneLoose: [],
	};
	for (const group of plan.groups) {
		if (group.status === "active") s.activeGroups.push(group);
		else if (group.status === "done") s.doneGroups.push(group);
		else s.pendingGroups.push(group);
	}
	for (const todo of plan.todos) {
		if (todo.status === "in_progress") s.activeLoose.push(todo);
		else if (todo.status === "done") s.doneLoose.push(todo);
		else s.pendingLoose.push(todo);
	}
	return s;
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
