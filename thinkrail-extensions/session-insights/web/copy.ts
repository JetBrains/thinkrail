import type { MessageKey } from "@thinkrail/locales";
import type { Translator } from "@thinkrail/locales/react";
import type { MetricId, Origin, SessionOutcome } from "@thinkrail/pi-session-insights/core";

export const BADGED = {
	recorded: false,
	counted: false,
	host: false,
	approximated: true,
	notRecorded: true,
	partiallyRecorded: true,
	notMeasured: true,
} as const satisfies Record<Origin, boolean>;

export type BadgedOrigin = { [K in Origin]: (typeof BADGED)[K] extends true ? K : never }[Origin];

export function isBadged(origin: Origin): origin is BadgedOrigin {
	return BADGED[origin];
}

export const ORIGIN_LABEL = {
	recorded: "sessionInsights.origin.recorded",
	counted: "sessionInsights.origin.counted",
	host: "sessionInsights.origin.host",
	approximated: "sessionInsights.origin.approximated",
	notRecorded: "sessionInsights.origin.notRecorded",
	partiallyRecorded: "sessionInsights.origin.partiallyRecorded",
	notMeasured: "sessionInsights.origin.notMeasured",
} as const satisfies Record<Origin, MessageKey>;

export const ORIGIN_NOTE = {
	approximated: "sessionInsights.originNote.approximated",
	notRecorded: "sessionInsights.originNote.notRecorded",
	partiallyRecorded: "sessionInsights.originNote.partiallyRecorded",
	notMeasured: "sessionInsights.originNote.notMeasured",
} as const satisfies Record<BadgedOrigin, MessageKey>;

export const BADGE_TEXT = {
	approximated: "sessionInsights.badge.approximated",
	notRecorded: "sessionInsights.badge.notRecorded",
	partiallyRecorded: "sessionInsights.badge.partiallyRecorded",
	notMeasured: "sessionInsights.badge.notMeasured",
} as const satisfies Record<BadgedOrigin, MessageKey>;

export const METRIC_HOW = {
	start: "sessionInsights.metric.start.how",
	wallTime: "sessionInsights.metric.wallTime.how",
	activeTime: "sessionInsights.metric.activeTime.how",
	tokens: "sessionInsights.metric.tokens.how",
	cost: "sessionInsights.metric.cost.how",
	subagentsOutside: "sessionInsights.metric.subagentsOutside.how",
	toolCalls: "sessionInsights.metric.toolCalls.how",
	toolErrors: "sessionInsights.metric.toolErrors.how",
	subagents: "sessionInsights.metric.subagents.how",
	llmCalls: "sessionInsights.metric.llmCalls.how",
	errors: "sessionInsights.metric.errors.how",
	turnDuration: "sessionInsights.metric.turnDuration.how",
	userWait: "sessionInsights.metric.userWait.how",
	waits: "sessionInsights.metric.waits.how",
	contextTokens: "sessionInsights.metric.contextTokens.how",
	contextWindow: "sessionInsights.metric.contextWindow.how",
	cacheMisses: "sessionInsights.metric.cacheMisses.how",
	warmCaches: "sessionInsights.metric.warmCaches.how",
	plan: "sessionInsights.metric.plan.how",
	skills: "sessionInsights.metric.skills.how",
	recovery: "sessionInsights.metric.recovery.how",
	subagentRun: "sessionInsights.metric.subagentRun.how",
	contextComposition: "sessionInsights.metric.contextComposition.how",
	cacheShare: "sessionInsights.metric.cacheShare.how",
	missCause: "sessionInsights.metric.missCause.how",
	callCost: "sessionInsights.metric.callCost.how",
	costMoment: "sessionInsights.metric.costMoment.how",
	fileTouches: "sessionInsights.metric.fileTouches.how",
	fileLines: "sessionInsights.metric.fileLines.how",
	fileReceipt: "sessionInsights.metric.fileReceipt.how",
	dailySpend: "sessionInsights.metric.dailySpend.how",
	toolStats: "sessionInsights.metric.toolStats.how",
	toolDuration: "sessionInsights.metric.toolDuration.how",
	modelLatency: "sessionInsights.metric.modelLatency.how",
	skillListing: "sessionInsights.metric.skillListing.how",
	subagentRoles: "sessionInsights.metric.subagentRoles.how",
	hotspots: "sessionInsights.metric.hotspots.how",
	finding: "sessionInsights.metric.finding.how",
	sequences: "sessionInsights.metric.sequences.how",
	sliceCompare: "sessionInsights.metric.sliceCompare.how",
	alignment: "sessionInsights.metric.alignment.how",
} as const satisfies Record<MetricId, MessageKey>;

export const OUTCOME_LABEL = {
	succeeded: "sessionInsights.outcome.succeeded",
	failed: "sessionInsights.outcome.failed",
	interrupted: "sessionInsights.outcome.interrupted",
	cancelled: "sessionInsights.outcome.cancelled",
} as const satisfies Record<SessionOutcome, MessageKey>;

export const OUTCOME_TONE = {
	succeeded: "border-feedback-success-muted text-feedback-success",
	failed: "border-feedback-error-muted text-feedback-error",
	interrupted: "border-feedback-warning-muted text-feedback-warning",
	cancelled: "border-feedback-warning-muted text-feedback-warning",
} as const satisfies Record<SessionOutcome, string>;

/** A session's name: its title, else its quoted first prompt, else "Untitled". */
export function sessionName(
	t: Translator,
	session: { title: string | null; firstPrompt: string | null },
): string {
	if (session.title) return session.title;
	if (session.firstPrompt)
		return t("sessionInsights.quotedPrompt", { prompt: session.firstPrompt });
	return t("sessionInsights.untitled");
}
