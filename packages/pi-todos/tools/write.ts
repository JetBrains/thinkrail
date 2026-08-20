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
			"Lay out a fresh plan: replace your own open items with these groups — one group per task (a user ask; title = the outcome), each with its ordered steps. Use it once, at the start of a multi-step task. The user's items and any completed (done) items are preserved — but don't use it to tweak an existing plan; for that use todo_update (progress an item) and todo_add (insert one).",
		promptSnippet:
			"todo_write — lay out a FRESH plan (groups only: one per task, steps inside; replaces your open items; keeps user items + done; use once at the start).",
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
