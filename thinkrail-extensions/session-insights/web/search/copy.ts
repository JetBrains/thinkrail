import type { MessageKey } from "@thinkrail/locales";
import type { SearchField, SearchFilterKey } from "@thinkrail/pi-session-insights/core";

export const FILTER_LABEL = {
	tool: "sessionInsights.search.filter.tool",
	error: "sessionInsights.search.filter.error",
	file: "sessionInsights.search.filter.file",
	skill: "sessionInsights.search.filter.skill",
	model: "sessionInsights.search.filter.model",
	project: "sessionInsights.search.filter.project",
	label: "sessionInsights.search.filter.label",
} as const satisfies Record<SearchFilterKey, MessageKey>;

/** "in result ×3": where else the terms occur. */
export const FIELD_COUNT = {
	prompt: "sessionInsights.search.in.prompt",
	reply: "sessionInsights.search.in.reply",
	args: "sessionInsights.search.in.args",
	result: "sessionInsights.search.in.result",
	error: "sessionInsights.search.in.error",
} as const satisfies Record<SearchField, MessageKey>;

export const FIELD_LABEL = {
	prompt: "sessionInsights.search.field.prompt",
	reply: "sessionInsights.search.field.reply",
	args: "sessionInsights.search.field.args",
	result: "sessionInsights.search.field.result",
	error: "sessionInsights.search.field.error",
} as const satisfies Record<SearchField, MessageKey>;

export const KIND_LABEL = {
	turn: "sessionInsights.search.kind.turn",
	llm: "sessionInsights.search.kind.llm",
	tool: "sessionInsights.search.kind.tool",
} as const satisfies Record<"turn" | "llm" | "tool", MessageKey>;

export type FacetKey = "tool" | "model" | "skill" | "project";

export const FACET_TITLE = {
	tool: "sessionInsights.search.facet.tool",
	model: "sessionInsights.search.facet.model",
	skill: "sessionInsights.search.facet.skill",
	project: "sessionInsights.search.facet.project",
} as const satisfies Record<FacetKey, MessageKey>;

export const FACET_NONE = {
	tool: "sessionInsights.search.none.tool",
	model: "sessionInsights.search.none.model",
	skill: "sessionInsights.search.none.skill",
	project: "sessionInsights.search.none.project",
} as const satisfies Record<FacetKey, MessageKey>;
