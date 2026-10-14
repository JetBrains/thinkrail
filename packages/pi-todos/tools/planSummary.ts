// todo_plan_summary — set the plan-level completion summary: the agent's short overall handoff note,
// written when every item in the plan is done (todo_update's done-flip nudges it at exactly that
// moment). It is CUMULATIVE across the whole plan — every task and every completion, not a recap of the
// last step. When a summary from an earlier completion survives (the plan gained new work and finished
// again), extend that text rather than rewriting it from scratch (the done-flip nudge surfaces it to
// build on). Stored on the plan file (`TodoFile.summary`); the UI shows it only while the plan stays
// fully done, and keeps the prior note visible (marked stale) while it is being redone.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { flatItems } from "../core/index.ts";
import { storeFor, textResult, withNudges } from "./shared.ts";

const parameters = Type.Object({
	summary: Type.String({
		description:
			"The CUMULATIVE completion summary for the WHOLE plan — everything accomplished across every task and every completion, not a recap of the last step. If a summary from an earlier completion already exists (a plan that gained new work and finished again — the done-flip nudge shows it to you), EXTEND it: carry every earlier point forward and add the new work, never narrow it down to only the most recent step. Write it in the PR-body shape so the host can feed it into renderPrBody as-is: three H2 sections in order — '## Summary' (what and why in prose, decisions the diff can't show, 'Closes #NNN' when issue-driven), '## Changes' (plan-scale cross-cutting notes: migrations, scope drift, new/dropped deps, renames — NOT a restatement of the step titles; the auto '## Plan' section already lists them with their own summaries), '## Testing' (end-to-end checks beyond per-step verification, each as a bullet in the shape 'check → result', or the honest 'not verified'). Include anything left undone or deferred inside the matching section — an omission reads as 'nothing left'. Empty string clears it.",
	}),
});

export function registerTodoPlanSummary(pi: ExtensionAPI): void {
	pi.registerTool<typeof parameters, { summary: string } | { error: string }>({
		name: "todo_plan_summary",
		label: "Todo Plan Summary",
		description:
			"Set the plan's overall completion summary — a short, CUMULATIVE handoff note covering EVERYTHING done across the whole plan (all tasks, all completions), not just the last step. Call it right after the last open item flips done (the todo_update result nudges you). When a summary from an earlier completion still exists, EXTEND it rather than rewriting from scratch. Shape it as a PR body (three H2 sections: '## Summary' / '## Changes' / '## Testing') — the host prepends this verbatim when it renders the PR body, so a well-shaped summary ships as-is. Not per-item: an item's own summary goes on todo_update's summary field.",
		promptSnippet:
			"todo_plan_summary — after the LAST item is done: a cumulative overall summary of EVERYTHING done across the plan, in PR-body shape (## Summary / ## Changes / ## Testing); extend the existing one, don't rewrite it down to the last step.",
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
