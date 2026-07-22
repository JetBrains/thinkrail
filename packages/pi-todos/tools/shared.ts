// Shared plumbing for the todo tools: the store accessor and the result helpers. Thin wrappers over
// `core/` — this is where the tools reach the filesystem (through `TodoStore`).

import type { AgentToolResult, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { type Todo, type TodoPlan, TodoStore } from "../core/index.ts";

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

/** The whole plan as text: loose items first, then each group under a `# Title` header (indented). */
export function formatPlan(plan: TodoPlan): string {
	const lines = plan.todos.map(formatTodo);
	for (const group of plan.groups) {
		lines.push(`# ${group.title}`);
		for (const todo of group.todos) lines.push(`  ${formatTodo(todo)}`);
	}
	return lines.join("\n");
}
