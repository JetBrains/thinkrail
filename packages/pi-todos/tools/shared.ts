import type { AgentToolResult, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	flatItems,
	groupStatus,
	type Todo,
	type TodoGroup,
	type TodoPlan,
	TodoStore,
} from "../core/index.ts";

export function storeFor(ctx: ExtensionContext): TodoStore {
	return new TodoStore(ctx.cwd, ctx.sessionManager.getSessionId());
}

export function textResult<T>(text: string, details: T): AgentToolResult<T> {
	return { content: [{ type: "text", text }], details };
}

export function errorResult(message: string): AgentToolResult<{ error: string }> {
	return { content: [{ type: "text", text: `Error: ${message}` }], details: { error: message } };
}

const GLYPH: Record<Todo["status"], string> = {
	pending: "[ ]",
	in_progress: "[~]",
	done: "[x]",
};

export function formatTodo(todo: Todo): string {
	return `${GLYPH[todo.status]} ${todo.title} — ${todo.id}`;
}

export function formatGroupHeader(group: TodoGroup): string {
	const done = group.todos.filter((t) => t.status === "done").length;
	return `▸ ${group.title} [${groupStatus(group)} ${done}/${group.todos.length}]`;
}

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

export function consistencyNudge(plan: TodoPlan): string | undefined {
	const open = flatItems(plan).filter((t) => t.status !== "done");
	if (open.length === 0 || open.some((t) => t.status === "in_progress")) return undefined;
	return "note: nothing is in_progress — flip the step you're working on.";
}

export function withNudges(text: string, ...nudges: (string | undefined)[]): string {
	const extra = nudges.filter((n): n is string => Boolean(n));
	return extra.length ? `${text}\n${extra.join("\n")}` : text;
}
