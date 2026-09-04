import { StringEnum } from "@earendil-works/pi-ai/compat";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { countItems, TODO_STATUSES, type TodoPlan, type WritePlan } from "../core/index.ts";
import { consistencyNudge, formatPlan, storeFor, textResult, withNudges } from "./shared.ts";

const item = Type.Object({
	title: Type.String({ description: "The item's one-line title." }),
	status: Type.Optional(
		StringEnum(TODO_STATUSES, { description: "Initial status (defaults to pending)." }),
	),
	note: Type.Optional(Type.String({ description: "A short secondary line." })),
});

const group = Type.Object({
	title: Type.String({
		description: 'The task\'s short name — an outcome ("Fix login redirect"), not a process.',
	}),
	todos: Type.Array(item, { description: "The task's ordered steps." }),
});

const parameters = Type.Object({
	groups: Type.Array(group, {
		description:
			"The plan as tasks: one group per user ask (title = the outcome), each carrying its ordered steps. A small ask is a small group (1–2 steps is fine). Loose items are the user's lane — you never author them.",
	}),
});

export function registerTodoWrite(pi: ExtensionAPI): void {
	pi.registerTool<typeof parameters, { plan: TodoPlan } | { error: string }>({
		name: "todo_write",
		label: "Todo Write",
		description:
			"Lay out or reconcile the plan as these groups — one group per task (a user ask; title = the outcome), each with its ordered steps. This RECONCILES, it does not destructively replace: written steps are matched to existing ones by group title + step title and keep their status/summary/id, so re-running it is safe and lossless (a re-listed in-progress or done step is NOT reset — status advances only via todo_update, and a status you pass here for an existing step is ignored). Unmatched written steps are created; your steps you omit are dropped; the user's items and completed (done) items are always preserved. Keep step titles stable across a re-plan — a reworded title reads as a new step. For a single change prefer todo_add/todo_update (cheaper than restating the whole plan).",
		promptSnippet:
			"todo_write — lay out or reconcile the plan (groups only; matches steps by title, keeps their progress; prefer todo_add/todo_update for one change).",
		parameters,
		async execute(_callId, params, _signal, _onUpdate, ctx) {
			const write: WritePlan = { groups: params.groups };
			const plan = storeFor(ctx).replaceAll(write);
			const count = countItems(plan);
			const text = count
				? withNudges(
						`Wrote the plan (${count} item(s) total):\n${formatPlan(plan)}`,
						consistencyNudge(plan),
					)
				: "Cleared the plan.";
			return textResult(text, { plan });
		},
	});
}
