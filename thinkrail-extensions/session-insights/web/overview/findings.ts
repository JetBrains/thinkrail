import type { MessageKey } from "@thinkrail/locales";
import { localeOf, type Translator } from "@thinkrail/locales/react";
import type { FindingRule, OverviewFinding } from "@thinkrail/pi-session-insights/core";
import { formatCost, formatCount, formatTokens } from "../format";

const SENTENCE = {
	skillNeverLoaded: "sessionInsights.overview.finding.skillNeverLoaded",
	skillUnlisted: "sessionInsights.overview.finding.skillUnlisted",
	commandFailing: "sessionInsights.overview.finding.commandFailing",
	falseError: "sessionInsights.overview.finding.falseError",
	loop: "sessionInsights.overview.finding.loop",
	poorRecovery: "sessionInsights.overview.finding.poorRecovery",
	oversizedOutput: "sessionInsights.overview.finding.oversizedOutput",
	contextLimit: "sessionInsights.overview.finding.contextLimit",
	cacheMisses: "sessionInsights.overview.finding.cacheMisses",
	costOutlier: "sessionInsights.overview.finding.costOutlier",
	tokenOutlier: "sessionInsights.overview.finding.tokenOutlier",
	subagentsOutside: "sessionInsights.overview.finding.subagentsOutside",
	rework: "sessionInsights.overview.finding.rework",
	repeatedInstruction: "sessionInsights.overview.finding.repeatedInstruction",
	unverifiedClaim: "sessionInsights.overview.finding.unverifiedClaim",
} as const satisfies Record<FindingRule, MessageKey>;

/** A finding as one sentence about this session, filled from the server's figures. */
export function findingText(t: Translator, finding: OverviewFinding): string {
	const locale = localeOf(t);
	const amount = (value: number | null | undefined) =>
		finding.rule === "tokenOutlier"
			? formatTokens(locale, value ?? 0)
			: formatCost(locale, value ?? 0);
	const own = finding.link?.value ?? finding.figures.largest?.value ?? null;
	return t(SENTENCE[finding.rule], {
		subject: finding.subject ?? "",
		names: finding.names.join(", "),
		count: formatCount(locale, finding.count),
		total: formatCount(locale, finding.total ?? 0),
		here: formatCount(locale, finding.link?.count ?? 0),
		ratio:
			finding.ratio === null
				? ""
				: new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(finding.ratio),
		value: amount(own),
		median: amount(finding.figures.median?.value),
		outside: formatCost(locale, finding.figures.outside?.value ?? 0),
	});
}
