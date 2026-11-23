import { localeOf, type Translator, useT } from "@thinkrail/locales/react";
import { IconTooltip } from "@thinkrail/ui/tooltip";
import { cn } from "@thinkrail/ui/utils";
import { SEVERITY_PILL } from "../copy";
import { formatCount } from "../format";
import type { FindingsTally } from "./useFindings";

/** "7 findings · 2 warnings, 5 info": the findings not hidden and how severe they are. */
export function findingsSummary(t: Translator, tally: FindingsTally): string {
	const severities = [
		tally.error > 0 ? t("sessionInsights.insights.badgeErrors", { count: tally.error }) : null,
		tally.warning > 0
			? t("sessionInsights.insights.badgeWarnings", { count: tally.warning })
			: null,
		tally.info > 0 ? t("sessionInsights.insights.badgeInfo", { count: tally.info }) : null,
	].filter((part) => part !== null);
	return t("sessionInsights.insights.badgeTitle", {
		findings: t("sessionInsights.insights.badge", { count: tally.total }),
		severities: severities.join(", "),
	});
}

/** The count of findings not hidden, in the colour of the most severe; nothing at zero. */
export function FindingsBadge({
	tally,
	testId,
	tooltip = false,
}: {
	tally: FindingsTally;
	testId: string;
	tooltip?: boolean;
}) {
	const t = useT();
	if (tally.total === 0) return null;
	const severity = tally.error > 0 ? "error" : tally.warning > 0 ? "warning" : "info";
	const summary = findingsSummary(t, tally);
	const badge = (
		<span
			data-testid={testId}
			data-severity={severity}
			className={cn(
				"rounded-full border px-4 tr-text-caption tabular-nums",
				SEVERITY_PILL[severity],
			)}
		>
			<span aria-hidden="true">{formatCount(localeOf(t), tally.total)}</span>
			<span className="sr-only">{summary}</span>
		</span>
	);
	return tooltip ? <IconTooltip label={summary}>{badge}</IconTooltip> : badge;
}
