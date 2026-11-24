import type { MessageKey } from "@thinkrail/locales";
import type { ContextCategory, MissCause, RequestRole } from "@thinkrail/pi-session-insights/core";
import type { SeriesKey } from "../trace/model";

/** The request's categories in prompt order (the core's `CONTEXT_CATEGORIES`, typed locally). */
export const CATEGORIES: readonly ContextCategory[] = [
	"tools",
	"system",
	"skills",
	"summary",
	"user",
	"assistant",
	"results",
	"thinking",
];

export const CATEGORY_SERIES = {
	tools: "series-8",
	system: "series-1",
	skills: "series-5",
	summary: "series-7",
	user: "primary",
	assistant: "series-3",
	results: "series-6",
	thinking: "series-2",
} as const satisfies Record<ContextCategory, SeriesKey>;

export const CATEGORY_SWATCH = {
	tools: "bg-series-8",
	system: "bg-series-1",
	skills: "bg-series-5",
	summary: "bg-series-7",
	user: "bg-primary",
	assistant: "bg-series-3",
	results: "bg-series-6",
	thinking: "bg-series-2",
} as const satisfies Record<ContextCategory, string>;

export const CATEGORY_LABEL = {
	tools: "sessionInsights.context.category.tools",
	system: "sessionInsights.context.category.system",
	skills: "sessionInsights.context.category.skills",
	summary: "sessionInsights.context.category.summary",
	user: "sessionInsights.context.category.user",
	assistant: "sessionInsights.context.category.assistant",
	results: "sessionInsights.context.category.results",
	thinking: "sessionInsights.context.category.thinking",
} as const satisfies Record<ContextCategory, MessageKey>;

export const CAUSE_LABEL = {
	modelChange: "sessionInsights.context.cause.modelChange",
	modelReselected: "sessionInsights.context.cause.modelReselected",
	systemPrompt: "sessionInsights.context.cause.systemPrompt",
	tools: "sessionInsights.context.cause.tools",
	compaction: "sessionInsights.context.cause.compaction",
	contextEdit: "sessionInsights.context.cause.contextEdit",
	thinkingLevel: "sessionInsights.context.cause.thinkingLevel",
	pause: "sessionInsights.context.cause.pause",
} as const satisfies Record<MissCause, MessageKey>;

export const ROLE_LABEL = {
	user: "sessionInsights.request.role.user",
	assistant: "sessionInsights.request.role.assistant",
	toolResult: "sessionInsights.request.role.toolResult",
	custom: "sessionInsights.request.role.custom",
	bashExecution: "sessionInsights.request.role.bashExecution",
	compactionSummary: "sessionInsights.request.role.compactionSummary",
	branchSummary: "sessionInsights.request.role.branchSummary",
	other: "sessionInsights.request.role.other",
} as const satisfies Record<RequestRole, MessageKey>;

export type CacheSplit = "read" | "write" | "input";

/**
 * The cache split of a request — read from cache, written to it, and neither — on the sequential ramp
 * (a share, not a verdict: the feedback roles stay for misses).
 */
export const CACHE_RAMP = { read: 3, write: 1, input: 0 } as const satisfies Record<
	CacheSplit,
	number
>;

export const CACHE_FILL = {
	read: "fill-ramp-4",
	write: "fill-ramp-2",
	input: "fill-ramp-1",
} as const satisfies Record<CacheSplit, string>;

export const CACHE_SWATCH = {
	read: "bg-ramp-4",
	write: "bg-ramp-2",
	input: "bg-ramp-1",
} as const satisfies Record<CacheSplit, string>;
