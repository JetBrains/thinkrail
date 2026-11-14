import type { SessionEntry } from "@earendil-works/pi-coding-agent";

export const NEXT_STEPS_TOOL_NAME = "suggest_next_steps";

export const MAX_SHORTCUTS = 9;

export interface NextStepsArgs {
	suggestions: string[];
}

export interface NextStepsDetails {
	suggestions: string[];
}

export function normalizeSuggestions(raw: readonly unknown[]): string[] {
	const seen = new Set<string>();
	const suggestions: string[] = [];
	for (const item of raw) {
		if (typeof item !== "string") continue;
		const text = item.replace(/\s+/g, " ").trim();
		const key = text.toLowerCase();
		if (!text || seen.has(key)) continue;
		seen.add(key);
		suggestions.push(text);
	}
	return suggestions;
}

export function isNextStepsDetails(value: unknown): value is NextStepsDetails {
	return (
		typeof value === "object" &&
		value !== null &&
		Array.isArray((value as NextStepsDetails).suggestions) &&
		(value as NextStepsDetails).suggestions.every((item) => typeof item === "string")
	);
}

const OUT_OF_CONVERSATION: ReadonlySet<SessionEntry["type"]> = new Set([
	"thinking_level_change",
	"model_change",
	"usage",
	"custom",
	"label",
	"session_info",
]);

export function suggestionsOnBranch(branch: readonly SessionEntry[]): string[] {
	for (let index = branch.length - 1; index >= 0; index--) {
		const entry = branch[index];
		if (!entry || OUT_OF_CONVERSATION.has(entry.type)) continue;
		if (entry.type !== "message") return [];
		const message = entry.message;
		if (message.role !== "toolResult" || message.toolName !== NEXT_STEPS_TOOL_NAME) return [];
		if (message.isError || !isNextStepsDetails(message.details)) return [];
		return message.details.suggestions;
	}
	return [];
}
