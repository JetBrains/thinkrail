import type { Translator } from "@thinkrail/locales/react";
import type { CostDiagnosis, SessionCost } from "@thinkrail/pi-session-insights/core";
import { formatCost, formatCount, formatShare, formatTokens } from "../format";

/** What the diagnosis template reads: the headline, the recorded total and the measured figures. */
export type DiagnosisSource = Pick<SessionCost, "headline" | "total" | "diagnosis">;

export function valueText(
	locale: string,
	cost: Pick<SessionCost, "headline">,
	value: number,
): string {
	return cost.headline === "tokens" ? formatTokens(locale, value) : formatCost(locale, value);
}

function focusClause(t: Translator, locale: string, d: CostDiagnosis): string {
	const focus = d.focus;
	if (!focus) return "";
	const items = focus.items
		.map((item) => t("sessionInsights.cost.focusItem", { n: item.n, title: item.title }))
		.join(t("sessionInsights.cost.focusJoin"));
	return t(
		focus.kind === "steps" ? "sessionInsights.cost.focusSteps" : "sessionInsights.cost.focusTurns",
		{
			share: formatShare(locale, focus.share, 1) ?? "",
			items,
			peak: formatTokens(locale, focus.peakContext),
		},
	);
}

/** The one-line diagnosis: a fixed template per kind, filled with the server's measured figures. */
export function diagnosisText(t: Translator, locale: string, cost: DiagnosisSource): string {
	const d = cost.diagnosis;
	const focus = focusClause(t, locale, d);
	const total = cost.total.value ?? 0;
	switch (d.kind) {
		case "none":
			return t("sessionInsights.cost.diagnosis.none");
		case "longContext":
			return t("sessionInsights.cost.diagnosis.longContext", {
				calls: formatCount(locale, d.calls),
				average: formatTokens(locale, d.averageContext),
				focus,
			});
		case "cacheRewrites":
			return t("sessionInsights.cost.diagnosis.cacheRewrites", {
				calls: formatCount(locale, d.rewrites?.calls ?? 0),
				value: valueText(locale, cost, d.rewrites?.value ?? 0),
				share: formatShare(locale, d.rewrites?.value ?? 0, total) ?? "",
				focus,
			});
		case "manyCalls":
			return t("sessionInsights.cost.diagnosis.manyCalls", {
				calls: formatCount(locale, d.calls),
				median: valueText(locale, cost, d.medianCall),
				focus,
			});
		case "spread":
			return t("sessionInsights.cost.diagnosis.spread", {
				calls: formatCount(locale, d.calls),
				median: valueText(locale, cost, d.medianCall),
				focus,
			});
	}
}
