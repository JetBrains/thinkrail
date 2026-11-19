import type {
	Figure,
	IndexState,
	ListProject,
	MetricId,
	Origin,
	SessionListRow,
	SessionsListResult,
} from "@thinkrail/pi-session-insights/core";

export const SOURCES: Readonly<Record<MetricId, readonly string[]>> = {
	start: ["entry.timestamp"],
	wallTime: ["entry.timestamp"],
	activeTime: ["entry.timestamp"],
	tokens: ["message[assistant].usage"],
	cost: ["message[assistant].usage.cost.total"],
	subagentsOutside: ["child transcript usage"],
	toolCalls: ["message[assistant].content[toolCall]"],
	toolErrors: ["message[toolResult].isError"],
	subagents: ["usage[kind=subagent].note"],
	llmCalls: ["message[assistant]"],
	errors: ["message[toolResult].isError"],
	turnDuration: ["entry.timestamp"],
	userWait: ["message[toolResult].durationMs"],
	waits: ["entry.timestamp"],
	contextTokens: ["message[assistant].usage.input"],
	contextWindow: ["host model catalog: contextWindow"],
	cacheMisses: ["message[assistant].usage.cacheRead"],
	warmCaches: ["message[assistant].timestamp"],
	plan: ["message[toolResult:todo_*].details.plan"],
	skills: ["message[assistant].content[toolCall:read].arguments.path"],
	recovery: ["message[toolResult].isError"],
	subagentRun: ["message[toolResult:Agent].details"],
	contextComposition: ["message[system].sections"],
	cacheShare: ["message[assistant].usage.cacheRead"],
	missCause: ["model_change"],
	callCost: ["message[assistant].usage.cost.total"],
	costMoment: ["message[assistant].usage"],
	fileTouches: ["message[assistant].content[toolCall:read|edit|write].arguments.path"],
	fileLines: ["message[toolResult:edit].details.patch"],
	fileReceipt: ["host turn receipts"],
	dailySpend: ["message[assistant].usage"],
	toolStats: ["message[toolResult].isError"],
	toolDuration: ["message[toolResult].durationMs"],
	modelLatency: ["message[assistant].durationMs"],
	skillListing: ["message[system].sections.skills"],
	subagentRoles: ["message[toolResult:Agent].details"],
	hotspots: ["message[assistant].content[toolCall:read|edit|write].arguments.path"],
	finding: ["message[toolResult].isError"],
	sequences: ["message[toolResult].isError"],
	sliceCompare: ["message[assistant].usage"],
	alignment: ["message[assistant].content[toolCall]"],
};

export const START = Date.UTC(2026, 10, 15, 9, 30);

export function figure<T>(value: T | null, origin: Origin): Figure<T> {
	return { value, origin };
}

export function tokenTotals(total: number) {
	const input = Math.floor(total / 2);
	return { input, output: total - input, cacheRead: 0, cacheWrite: 0, total };
}

export function sessionRow(
	sessionId: string,
	overrides: Partial<SessionListRow> = {},
): SessionListRow {
	return {
		sessionId,
		projectId: "p1",
		workspaceId: "w1",
		workspaceName: "main",
		workspaceState: "open",
		title: `Session ${sessionId}`,
		firstPrompt: `Prompt of ${sessionId}`,
		live: false,
		outcome: "succeeded",
		start: figure(START, "counted"),
		activeMs: figure(12 * 60_000, "approximated"),
		tokens: figure(tokenTotals(8_200_000), "recorded"),
		cost: figure(2.04, "recorded"),
		subagentsOutside: figure({ cost: 0, tokens: 0 }, "recorded"),
		toolCalls: figure(70, "counted"),
		toolErrors: figure(2, "counted"),
		subagents: figure(0, "counted"),
		models: ["anthropic/claude-test"],
		...overrides,
	};
}

export const PROJECTS: readonly ListProject[] = [
	{ id: "p1", name: "Alpha", kind: "repository" },
	{ id: "p2", name: "Beta", kind: "repository" },
];

export function listResult(
	rows: readonly SessionListRow[],
	options: { projects?: readonly ListProject[]; state?: IndexState } = {},
): SessionsListResult {
	return {
		apiVersion: 10,
		state: options.state ?? { phase: "ready", indexed: rows.length, total: rows.length },
		projects: options.projects ?? PROJECTS,
		rows,
		sources: SOURCES,
	};
}
