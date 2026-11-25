import type { MessageKey } from "@thinkrail/locales";
import type { TraceEvent } from "@thinkrail/pi-session-insights/core";

export type DetailTab = "prompt" | "reply" | "input" | "result" | "subagent" | "content" | "raw";

export const TAB_LABEL = {
	prompt: "sessionInsights.details.tab.prompt",
	reply: "sessionInsights.details.tab.reply",
	input: "sessionInsights.details.tab.input",
	result: "sessionInsights.details.tab.result",
	subagent: "sessionInsights.details.tab.subagent",
	content: "sessionInsights.details.tab.content",
	raw: "sessionInsights.details.tab.raw",
} as const satisfies Record<DetailTab, MessageKey>;

/** The tabs a row kind has, most useful first. */
export function tabsFor(event: TraceEvent): readonly DetailTab[] {
	switch (event.kind) {
		case "turn":
			return event.trigger === "prompt" ? ["prompt", "raw"] : ["content", "raw"];
		case "llm":
			return ["reply", "raw"];
		case "tool":
			return ["input", "result", "raw"];
		case "subagent":
			return ["subagent", "input", "raw"];
		case "mark":
			return ["content", "raw"];
	}
}

/** The tab to show: the one last picked when this kind has it, a failing call's result, else the first. */
export function initialTab(event: TraceEvent, last: DetailTab | null): DetailTab {
	const tabs = tabsFor(event);
	if (last && tabs.includes(last)) return last;
	if (event.kind === "tool" && event.error) return "result";
	return tabs[0] ?? "raw";
}

/** Tools whose chat renderer reads well from recorded arguments and output alone. */
export const RENDERED_TOOLS: ReadonlySet<string> = new Set(["bash", "edit", "write", "read"]);
