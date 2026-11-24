import type { MessageKey } from "@thinkrail/locales";
import type { Translator } from "@thinkrail/locales/react";
import type {
	Figure,
	PlanStatus,
	SessionAnalysis,
	SkillScopeEnd,
	TokenTotals,
} from "@thinkrail/pi-session-insights/core";
import { formatCost, formatTokens } from "../format";
import type { BandPick } from "./bands";

export const PLAN_STATUS_LABEL = {
	pending: "sessionInsights.plan.status.pending",
	inProgress: "sessionInsights.plan.status.inProgress",
	done: "sessionInsights.plan.status.done",
	removed: "sessionInsights.plan.status.removed",
	promoted: "sessionInsights.plan.status.promoted",
} as const satisfies Record<PlanStatus, MessageKey>;

export const SCOPE_LABEL = {
	nextSkill: "sessionInsights.plan.scope.nextSkill",
	turnEnd: "sessionInsights.plan.scope.turnEnd",
	sessionEnd: "sessionInsights.plan.scope.sessionEnd",
} as const satisfies Record<SkillScopeEnd, MessageKey>;

/** Spend by the headline rule: tokens where the recorded cost is $0 or not recorded, else cost. */
export function spendLabel(
	t: Translator,
	locale: string,
	cost: Figure,
	tokens: Figure<TokenTotals>,
): string {
	const total = tokens.value?.total ?? 0;
	if (cost.value === null || cost.origin === "notRecorded" || (cost.value === 0 && total > 0))
		return t("sessionInsights.turns.tokens", { tokens: formatTokens(locale, total) });
	return formatCost(locale, cost.value);
}

/** A band pick's one-line description: the step with its status and spend, or the skill and scope. */
export function bandLabel(
	t: Translator,
	locale: string,
	analysis: SessionAnalysis | null,
	pick: BandPick,
): string {
	if (pick.kind === "skill") {
		const skill = analysis?.skills[pick.index];
		if (!skill) return "";
		return t(
			skill.workflow
				? "sessionInsights.plan.workflowSkillHover"
				: "sessionInsights.plan.skillHover",
			{ name: skill.name, scope: t(SCOPE_LABEL[skill.scopeBy]) },
		);
	}
	const steps = analysis?.plan?.steps ?? [];
	const at = steps.findIndex((step) => step.id === pick.id);
	const step = steps[at];
	if (!step) return "";
	return t("sessionInsights.plan.stepHover", {
		n: at + 1,
		title: step.title,
		status: t(PLAN_STATUS_LABEL[step.status]),
		spend: spendLabel(t, locale, step.cost, step.tokens),
	});
}
