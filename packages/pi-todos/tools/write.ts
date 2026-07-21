// todo_write — lay out a fresh plan: loose items + named groups (each a title with its own item list).
// User items and done items are preserved (see TodoStore.replaceAll). The plan-first pattern: the agent
// decomposes a task up front, then flips items with todo_update as it works.

import { StringEnum } from "@earendil-works/pi-ai/compat";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { countItems, TODO_STATUSES, type TodoPlan, type WritePlan } from "../core/index.ts";
import { formatPlan, storeFor, textResult } from "./shared.ts";

const item = Type.Object({
	title: Type.String({ description: "The item's one-line title." }),
	status: Type.Optional(
		StringEnum(TODO_STATUSES, { description: "Initial status (defaults to pending)." }),
	),
	note: Type.Optional(Type.String({ description: "A short secondary line." })),
});

const group = Type.Object({
	title: Type.String({ description: "The group's short name (a heading for its items)." }),
	todos: Type.Array(item, { description: "The group's ordered items." }),
});

const parameters = Type.Object({
	todos: Type.Optional(
		Type.Array(item, {
			description:
				"Loose items that don't belong to a group — standalone tasks. Leave empty when the plan is all groups.",
		}),
	),
	groups: Type.Optional(
		Type.Array(group, {
			description:
				"Named groups, each a title + its own list of items. Use groups when the work splits into distinct threads/areas; a simple plan can be all loose items and no groups.",
		}),
	),
});

export function registerTodoWrite(pi: ExtensionAPI): void {
	pi.registerTool<typeof parameters, { plan: TodoPlan } | { error: string }>({
		name: "todo_write",
		label: "Todo Write",
		description:
			"Lay out a fresh plan: replace your own open items with this one. Give loose `todos` for standalone tasks and/or `groups` (each a title + its item list) for distinct threads — author a group as a whole, don't tag items one by one. Use it once, at the start of a multi-step task. The user's items and any completed (done) items are preserved — but don't use it to tweak an existing plan; for that use todo_update (progress an item) and todo_add (append one).",
		promptSnippet:
			"todo_write — lay out a FRESH plan (loose items + named groups; replaces your open items; keeps user items + done; use once at the start).",
		parameters,
		async execute(_callId, params, _signal, _onUpdate, ctx) {
			const write: WritePlan = {};
			if (params.todos) write.todos = params.todos;
			if (params.groups) write.groups = params.groups;
			const plan = storeFor(ctx).replaceAll(write);
			const count = countItems(plan);
			const text = count
				? `Wrote the plan (${count} item(s) total):\n${formatPlan(plan)}`
				: "Cleared the plan.";
			return textResult(text, { plan });
		},
	});
}
