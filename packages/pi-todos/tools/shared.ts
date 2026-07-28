// Shared plumbing for the todo tools: the store accessor and the result helpers. Thin wrappers over
// `core/` — this is where the tools reach the filesystem (through `TodoStore`).

import type { AgentToolResult, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	flatItems,
	groupStatus,
	type Todo,
	type TodoGroup,
	type TodoPlan,
	TodoStore,
} from "../core/index.ts";

/**
 * The store for the tool's active chat session — the TODO list is chat-scoped. The session id comes from
 * `ctx.sessionManager`, so the tool always writes the list of the conversation it runs in. `TodoStore`
 * holds no mutable state (it re-reads the file every op), so a fresh instance per call is free — no cache.
 */
export function storeFor(ctx: ExtensionContext): TodoStore {
	return new TodoStore(ctx.cwd, ctx.sessionManager.getSessionId());
}

/** Wrap text + structured details into the agent tool-result shape. */
export function textResult<T>(text: string, details: T): AgentToolResult<T> {
	return { content: [{ type: "text", text }], details };
}

/** An error result carrying a message the model can act on. */
export function errorResult(message: string): AgentToolResult<{ error: string }> {
	return { content: [{ type: "text", text: `Error: ${message}` }], details: { error: message } };
}

/** A single-line status glyph for rendering a todo in tool output. */
const GLYPH: Record<Todo["status"], string> = {
	pending: "[ ]",
	in_progress: "[~]",
	done: "[x]",
};

/** One human-readable line for a todo (glyph, title, id). */
export function formatTodo(todo: Todo): string {
	return `${GLYPH[todo.status]} ${todo.title} — ${todo.id}`;
}

/** A group's header line: derived task status + progress — `▸ Fix login redirect [active 1/4]`. */
export function formatGroupHeader(group: TodoGroup): string {
	const done = group.todos.filter((t) => t.status === "done").length;
	return `▸ ${group.title} [${groupStatus(group)} ${done}/${group.todos.length}]`;
}

/**
 * The whole plan as text, group-first: each group — a task — under its status/progress header with its
 * steps indented, then the loose lane (the user's own adds) **last** under a `Your requests:` header.
 * The user's lane sits at the end on purpose: a request added mid-task queues *after* the agent's
 * current work, so reading the plan top-to-bottom resumes/finishes the active task before those items.
 * The same two-level order the user sees (`TodoList`) and the markdown snapshot (`planMarkdown`) use.
 */
export function formatPlan(plan: TodoPlan): string {
	const lines: string[] = [];
	for (const group of plan.groups) {
		lines.push(formatGroupHeader(group));
		for (const todo of group.todos) lines.push(`  ${formatTodo(todo)}`);
	}
	if (plan.todos.length > 0) {
		if (plan.groups.length > 0) lines.push("Your requests:");
		for (const todo of plan.todos) lines.push(formatTodo(todo));
	}
	return lines.join("\n");
}

/**
 * The status-discipline nudge: when the plan has open items but none is in_progress, remind the agent
 * to flip the step it's working on. Appended to tool results — in-band feedback at exactly the moment
 * the agent touches the list, instead of relying on model memory. Undefined when the state is fine.
 */
export function consistencyNudge(plan: TodoPlan): string | undefined {
	const open = flatItems(plan).filter((t) => t.status !== "done");
	if (open.length === 0 || open.some((t) => t.status === "in_progress")) return undefined;
	return "note: nothing is in_progress — flip the step you're working on.";
}

/** Append nudge lines (skipping empties) to a result text. */
export function withNudges(text: string, ...nudges: (string | undefined)[]): string {
	const extra = nudges.filter((n): n is string => Boolean(n));
	return extra.length ? `${text}\n${extra.join("\n")}` : text;
}
