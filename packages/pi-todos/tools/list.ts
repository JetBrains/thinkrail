import { StringEnum } from "@earendil-works/pi-ai/compat";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { countItems, TODO_STATUSES, type TodoPlan } from "../core/index.ts";
import {
	consistencyNudge,
	formatPlan,
	formatTodo,
	storeFor,
	textResult,
	withNudges,
} from "./shared.ts";

const parameters = Type.Object({
	status: Type.Optional(
		StringEnum(TODO_STATUSES, {
			description:
				"Filter to one status: pending | in_progress | done (flat across groups). Omit for the whole plan.",
		}),
	),
});

export function registerTodoList(pi: ExtensionAPI): void {
	pi.registerTool<typeof parameters, { plan: TodoPlan } | { error: string }>({
		name: "todo_list",
		label: "Todo List",
		description:
			"Read this chat's TODO plan — loose items plus named groups (optionally filtered by status). The plan is the source of truth and the user may add or remove items at any time, so re-read it at the start of a turn, before picking the next item, and before you finish — to catch their edits.",
		promptSnippet:
			"todo_list — read this chat's TODO plan (source of truth; re-read to catch the user's edits).",
		parameters,
		async execute(_callId, params, _signal, _onUpdate, ctx) {
			const store = storeFor(ctx);
			const plan = store.read();
			if (params.status) {
				const status = params.status;
				const items = store.list(status);
				const text = items.length ? items.map(formatTodo).join("\n") : `No ${status} TODOs.`;
				const filtered: TodoPlan = {
					todos: plan.todos.filter((t) => t.status === status),
					groups: plan.groups
						.map((g) => ({ ...g, todos: g.todos.filter((t) => t.status === status) }))
						.filter((g) => g.todos.length > 0),
				};
				return textResult(text, { plan: filtered });
			}
			return textResult(
				countItems(plan)
					? withNudges(formatPlan(plan), consistencyNudge(plan))
					: "The plan is empty.",
				{ plan },
			);
		},
	});
}
