import type {
	LlmEvent,
	MarkEvent,
	SubagentEvent,
	ToolEvent,
	ToolFamily,
	TraceEvent,
	TurnEvent,
	TurnTrigger,
} from "@thinkrail/pi-session-insights/core";

export const T0 = Date.UTC(2026, 10, 1, 10, 0, 0);

export function turn(
	id: string,
	n: number,
	t0: number,
	t1 = t0,
	trigger: TurnTrigger = "prompt",
): TurnEvent {
	return {
		kind: "turn",
		id,
		parent: null,
		depth: 0,
		t0,
		t1,
		timing: "notMeasured",
		label: `prompt ${n}`,
		n,
		trigger,
		chars: 10,
	};
}

export function llm(
	id: string,
	parent: string | null,
	t0: number,
	t1: number,
	extra: Partial<LlmEvent> = {},
): LlmEvent {
	return {
		kind: "llm",
		id,
		parent,
		depth: parent ? 1 : 0,
		t0,
		t1,
		timing: "recorded",
		label: "",
		model: "anthropic/claude-test",
		stop: "toolUse",
		tokens: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, total: 10 },
		cost: 0.01,
		replyChars: 0,
		thinking: "none",
		calls: 1,
		...extra,
	};
}

export function tool(
	id: string,
	parent: string,
	t0: number,
	t1: number,
	extra: Partial<ToolEvent> & { family?: ToolFamily } = {},
): ToolEvent {
	return {
		kind: "tool",
		id,
		parent,
		depth: 2,
		t0,
		t1,
		timing: "recorded",
		label: "bun test",
		tool: "bash",
		family: "execution",
		toolCallId: `call-${id}`,
		argsChars: 20,
		resultChars: 4,
		...extra,
	};
}

export function subagent(id: string, parent: string, t0: number, t1: number): SubagentEvent {
	return {
		kind: "subagent",
		id,
		parent,
		depth: 3,
		t0,
		t1,
		timing: "recorded",
		label: "Map the repo",
		childId: id,
		role: "scout",
		status: "completed",
		tokens: 10,
		cost: 0.1,
	};
}

export function mark(id: string, parent: string | null, at: number): MarkEvent {
	return {
		kind: "mark",
		id,
		parent,
		depth: parent ? 1 : 0,
		t0: at,
		t1: at,
		timing: "notMeasured",
		label: "",
		mark: "modelChange",
		detail: "openai/gpt-test",
	};
}

/** Two turns: the first with a call making a failing and a passing tool call (one spawning a subagent). */
export function sampleEvents(): TraceEvent[] {
	return [
		mark("m0", null, T0),
		turn("u1", 1, T0 + 1_000, T0 + 40_000),
		llm("a1", "u1", T0 + 2_000, T0 + 6_000),
		tool("t1", "a1", T0 + 6_000, T0 + 9_000, { error: true, exit: "1" }),
		tool("t2", "a1", T0 + 6_000, T0 + 30_000, {
			tool: "Agent",
			family: "subagent",
			label: "scout: map",
		}),
		subagent("s1", "t2", T0 + 6_000, T0 + 30_000),
		llm("a2", "u1", T0 + 31_000, T0 + 40_000, { stop: "stop", calls: 0, label: "Done." }),
		turn("u2", 2, T0 + 600_000, T0 + 610_000),
		llm("a3", "u2", T0 + 601_000, T0 + 610_000, { stop: "error", error: true }),
	];
}
