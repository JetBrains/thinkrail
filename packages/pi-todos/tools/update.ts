import { StringEnum } from "@earendil-works/pi-ai/compat";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { TODO_STATUSES, type Todo, type TodoPatch, type TodoPlan } from "../core/index.ts";
import {
	consistencyNudge,
	errorResult,
	formatTodo,
	storeFor,
	textResult,
	withNudges,
} from "./shared.ts";

const parameters = Type.Object({
	id: Type.String({ description: "Id of the item to update." }),
	status: Type.Optional(
		StringEnum(TODO_STATUSES, {
			description:
				"New lifecycle status: pending | in_progress | done. Setting in_progress auto-returns any other in_progress item to pending (one step in work at a time).",
		}),
	),
	title: Type.Optional(Type.String({ description: "New title." })),
	note: Type.Optional(Type.String({ description: "New note (empty string clears it)." })),
	summary: Type.Optional(
		Type.String({
			description:
				"Completion summary, set together with status=done when the step changed code: 1–3 short sentences — what changed, why (decisions not visible in the diff), and any scope drift (things touched beyond this step). Verification goes in the separate verification field, not here. Empty string clears it.",
		}),
	),
	verification: Type.Optional(
		Type.String({
			description:
				'Verification line, set together with status=done: the EXACT check you ran and its result ("bun test src/todos — 34 pass", "typecheck green") — or "not verified" when you ran nothing. Never claim a check you did not run. Empty string clears it.',
		}),
	),
});

function nextOpenStep(plan: TodoPlan, id: string): Todo | undefined {
	const group = plan.groups.find((g) => g.todos.some((t) => t.id === id));
	return group?.todos.find((t) => t.status !== "done");
}

/** Plan-complete nudge: every item everywhere is done — ask for the overall summary, once per flip. */
function planCompleteNudge(plan: TodoPlan): string | undefined {
	const items = [...plan.todos, ...plan.groups.flatMap((g) => g.todos)];
	if (items.length === 0 || items.some((t) => t.status !== "done")) return undefined;
	return "plan complete — write a short overall summary with todo_plan_summary (what was done, across all tasks).";
}

export function registerTodoUpdate(pi: ExtensionAPI): void {
	pi.registerTool<typeof parameters, { todo: Todo; paused: Todo[] } | { error: string }>({
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
			if (params.summary !== undefined) patch.summary = params.summary;
			if (params.verification !== undefined) patch.verification = params.verification;
			const store = storeFor(ctx);
			const result = store.update(params.id, patch);
			if (!result) return errorResult(`No TODO with id "${params.id}".`);
			const { todo, paused } = result;
			let text = `Updated: ${formatTodo(todo)}`;
			if (paused.length > 0)
				text += `\n(paused: ${paused.map((t) => `${t.id} "${t.title}"`).join(", ")} — back to pending)`;
			const plan = store.read();
			const next = params.status === "done" ? nextOpenStep(plan, params.id) : undefined;
			text = withNudges(
				text,
				next ? `next: ${next.id} "${next.title}" — mark it in_progress when you start.` : undefined,
				next ? undefined : consistencyNudge(plan),
				params.status === "done" ? planCompleteNudge(plan) : undefined,
			);
			return textResult(text, { todo, paused });
		},
	});
}
