// todo_add — append one item to the chat's TODO list without touching the rest.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { Todo, TodoInput } from "../core/index.ts";
import { formatTodo, storeFor, textResult } from "./shared.ts";

const parameters = Type.Object({
	title: Type.String({ description: "The item's one-line title." }),
	group: Type.Optional(
		Type.String({
			description:
				"Title of a named group to append into — created if it doesn't exist yet. Omit to add a loose (standalone) item.",
		}),
	),
	note: Type.Optional(
		Type.String({ description: "A short secondary line (origin hint or detail)." }),
	),
});

export function registerTodoAdd(pi: ExtensionAPI): void {
	pi.registerTool<typeof parameters, { todo: Todo } | { error: string }>({
		name: "todo_add",
		label: "Todo Add",
		description:
			"Append one item to this chat's TODO list (a title, optional group + note) without touching the rest — use it to extend the plan (a follow-up you discover) or to slot in a new task. Pass `group` to add it into a named group (created if new), else it's loose. Prefer this over todo_write for a single addition, which never disturbs existing (esp. done) items.",
		promptSnippet:
			"todo_add — append one item to the list (loose, or into a named group; leaves the rest, incl. done, untouched).",
		parameters,
		async execute(_callId, params, _signal, _onUpdate, ctx) {
			const input: TodoInput = { title: params.title };
			if (params.group !== undefined) input.group = params.group;
			if (params.note !== undefined) input.note = params.note;
			const todo = storeFor(ctx).add(input);
			return textResult(`Added: ${formatTodo(todo)}`, { todo });
		},
	});
}
