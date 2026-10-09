export const SCENARIO_NAMES = [
	"chat-streaming",
	"region-toggles",
	"live-file-edits",
	"large-diff",
	"long-stream",
	"long-stream-xl",
	"parallel-agents",
	"background-agents",
] as const;

export type ScenarioName = (typeof SCENARIO_NAMES)[number];

export const DEFAULT_SCENARIOS: readonly ScenarioName[] = [
	"chat-streaming",
	"region-toggles",
	"live-file-edits",
	"large-diff",
];

export function isScenarioName(name: string): name is ScenarioName {
	return (SCENARIO_NAMES as readonly string[]).includes(name);
}
