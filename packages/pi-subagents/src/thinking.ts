import type { ThinkingLevel } from "@earendil-works/pi-agent-core";

export const THINKING_LEVELS = [
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
] as const satisfies readonly ThinkingLevel[];

const levels = new Set<string>(THINKING_LEVELS);

export function isThinkingLevel(value: string): value is ThinkingLevel {
	return levels.has(value);
}
