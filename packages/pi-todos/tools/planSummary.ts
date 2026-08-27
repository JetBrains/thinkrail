// todo_plan_summary — set the plan-level completion summary: the agent's short overall handoff note,
// written when every item in the plan is done (todo_update's done-flip nudges it at exactly that
// moment). Stored on the plan file (`TodoFile.summary`); the UI shows it only while the plan stays
// fully done, so a re-opened plan hides it until the agent rewrites it at the next completion.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { flatItems } from "../core/index.ts";
import { storeFor, textResult, withNudges } from "./shared.ts";

const parameters = Type.Object({
	summary: Type.String({
		description:
			"The overall completion summary for the whole plan: 2–4 short sentences — what was accomplished across all tasks, anything notable, and the verification performed. Empty string clears it.",
	}),
});

export function registerTodoPlanSummary(pi: ExtensionAPI): void {
	pi.registerTool<typeof parameters, { summary: string } | { error: string }>({
		name: "todo_plan_summary",
		label: "Todo Plan Summary",
		description:
			"Set the plan's overall completion summary — a short handoff note covering the whole plan. Call it once, right after the last open item flips done (the todo_update result nudges you). Not per-item: an item's own summary goes on todo_update's summary field.",
		promptSnippet:
			"todo_plan_summary — after the LAST item is done: a short overall summary of what the plan accomplished.",
		parameters,
		async execute(_callId, params, _signal, _onUpdate, ctx) {
			const store = storeFor(ctx);
			const summary = params.summary.trim();
			store.setSummary(summary);
			if (!summary) return textResult("Plan summary cleared.", { summary });
			const open = flatItems(store.read()).filter((t) => t.status !== "done").length;
			if (open > 0) {
				// Accepted (the note may still be useful) but flagged: the UI won't show it until all done.
				return textResult(
					withNudges(
						"Plan summary saved.",
						`note: ${open} item(s) are still open — the summary shows once everything is done.`,
					),
					{ summary },
				);
			}
			return textResult("Plan summary saved.", { summary });
		},
	});
}
