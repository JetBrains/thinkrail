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
	title: Type.String({
		description:
			'The step\'s one-line title: imperative and about the change/outcome, short and scannable — not the process ("make a plan", "read the files") and not agent bookkeeping (that goes in note).',
	}),
	group: Type.Optional(
		Type.String({
			description:
				"Title of the group (task) to append into — created if it doesn't exist yet. Omit `group` and `after` to drop a raw item into the loose queue (a shared scratchpad with the user) — do that for unprocessed notes, not for work you are about to execute: a loose item you take into work gets promoted into a proper group first (see the skill).",
		}),
	),
	after: Type.Optional(
		Type.String({
			description:
				"Id of an existing step to insert right after — the surgical mid-plan insert. Must be a step inside a task, never one of the user's own loose items. When given, `group` is ignored (the new item joins that step's group).",
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
			"Add one item to this chat's TODO plan without touching the rest. Pass `group` (the task it belongs to — created if new) to append it as that task's next step, `after` (the id of an existing step **inside a task**) to insert it right after that step, or omit both to drop a raw item into the loose queue — the shared pre-work scratchpad you and the user both write to. Loose is for unprocessed notes/kernels only; when you actually take a loose item into work you promote it into a group first (see the skill). An `after` pointing at a loose item is rejected. Prefer this over todo_write for a single addition, which never disturbs existing (esp. done) items.",
		promptSnippet:
			"todo_add — add one step (into a `group`, `after` an existing step, or loose when both are omitted — a shared scratchpad with the user; promote before working it).",
		parameters,
		async execute(_callId, params, _signal, _onUpdate, ctx) {
			const store = storeFor(ctx);
			if (params.after !== undefined) {
				const plan = store.read();
				if (!plan.groups.some((g) => g.todos.some((t) => t.id === params.after))) {
					const known = plan.todos.some((t) => t.id === params.after);
					return errorResult(
						known
							? `"${params.after}" is a loose item — anchor to a step inside a task, or pass \`group\` to append there (loose items are promoted into a group, not grown with siblings).`
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
