// todo_update — change an item's status / title / note. This is how the agent progresses its plan
// (pending → in_progress → done) as it works.

import { StringEnum } from "@earendil-works/pi-ai/compat";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { TODO_STATUSES, type Todo, type TodoPatch } from "../core/index.ts";
import { errorResult, formatTodo, storeFor, textResult } from "./shared.ts";

const parameters = Type.Object({
	id: Type.String({ description: "Id of the item to update." }),
	status: Type.Optional(
		StringEnum(TODO_STATUSES, {
			description: "New lifecycle status: pending | in_progress | done.",
		}),
	),
	title: Type.Optional(Type.String({ description: "New title." })),
	note: Type.Optional(Type.String({ description: "New note (empty string clears it)." })),
});

export function registerTodoUpdate(pi: ExtensionAPI): void {
	pi.registerTool<typeof parameters, { todo: Todo } | { error: string }>({
		name: "todo_update",
		label: "Todo Update",
		description:
			"Update one item by id (status, title, or note) — the tool for progressing your plan: flip an item to in_progress when you start it and done when you finish. Marking done is how items complete — they STAY in the list as history (don't remove them). This is the safe way to edit the list: it touches only the one item.",
		promptSnippet:
			"todo_update — progress one item (in_progress on start, done when finished; done items stay).",
		parameters,
		async execute(_callId, params, _signal, _onUpdate, ctx) {
			const patch: TodoPatch = {};
			if (params.status !== undefined) patch.status = params.status;
			if (params.title !== undefined) patch.title = params.title;
			if (params.note !== undefined) patch.note = params.note;
			const todo = storeFor(ctx).update(params.id, patch);
			if (!todo) return errorResult(`No TODO with id "${params.id}".`);
			return textResult(`Updated: ${formatTodo(todo)}`, { todo });
		},
	});
}
