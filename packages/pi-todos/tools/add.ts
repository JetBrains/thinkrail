// todo_add — add one step to the chat's TODO plan without touching the rest. The agent's items always
// live in a group (group = task); loose items are the user's lane, so the tool requires `group` or
// `after` — the agent structurally cannot author a loose item.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { Todo, TodoInput } from "../core/index.ts";
import {
	consistencyNudge,
	errorResult,
	formatTodo,
	storeFor,
	textResult,
	withNudges,
} from "./shared.ts";

const parameters = Type.Object({
	title: Type.String({ description: "The item's one-line title." }),
	group: Type.Optional(
		Type.String({
			description:
				"Title of the group (task) to append into — created if it doesn't exist yet. Required unless `after` is given: your items always belong to a group; loose items are the user's lane.",
		}),
	),
	after: Type.Optional(
		Type.String({
			description:
				"Id of an existing step to insert right after — the surgical mid-plan insert. Must be a step inside a task, never one of the user's own items. When given, `group` is ignored (the new item joins that step's group).",
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
			"Add one item to this chat's TODO plan without touching the rest. Pass `group` (the task it belongs to — created if new) to append it as that task's next step, or `after` (the id of an existing step **inside a task**) to insert it right after that step — one of the two is required: your items always live in a group, the loose lane belongs to the user, so an `after` pointing at one of the user's own items is rejected. Prefer this over todo_write for a single addition, which never disturbs existing (esp. done) items.",
		promptSnippet:
			"todo_add — add one step (into a `group`, or `after` an existing step; leaves the rest, incl. done, untouched).",
		parameters,
		async execute(_callId, params, _signal, _onUpdate, ctx) {
			if (params.group === undefined && params.after === undefined) {
				return errorResult(
					"Pass `group` (the task this step belongs to) or `after` (an existing step id) — loose items are the user's lane.",
				);
			}
			const store = storeFor(ctx);
			if (params.after !== undefined) {
				// The insert inherits the anchor's lane, so an anchor in the *user's* lane would put an
				// agent-origin open item there — which the next `todo_write` drops (loose keeps only user or
				// done items), i.e. the step would show up among the user's requests and then silently
				// vanish. Anchors must be steps inside a task. `TodoStore.add` stays permissive on purpose:
				// the host writes the user's own lane through it.
				const plan = store.read();
				if (!plan.groups.some((g) => g.todos.some((t) => t.id === params.after))) {
					const known = plan.todos.some((t) => t.id === params.after);
					return errorResult(
						known
							? `"${params.after}" is one of the user's own items — anchor to a step inside a task, or pass \`group\` to append there.`
							: `No step with id "${params.after}" to insert after.`,
					);
				}
			}
			const input: TodoInput = { title: params.title };
			if (params.after !== undefined) input.after = params.after;
			else if (params.group !== undefined) input.group = params.group;
			if (params.note !== undefined) input.note = params.note;
			let todo: Todo;
			try {
				todo = store.add(input);
			} catch (err) {
				return errorResult(err instanceof Error ? err.message : String(err));
			}
			return textResult(withNudges(`Added: ${formatTodo(todo)}`, consistencyNudge(store.read())), {
				todo,
			});
		},
	});
}
