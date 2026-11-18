import type { SessionTimeline, TurnSummary } from "@thinkrail/pi-session-insights/core";
import { T0 } from "../trace/events.test";

/** A turn card's payload over `sampleEvents()`'s turns. */
export function summary(id: string, n: number, extra: Partial<TurnSummary> = {}): TurnSummary {
	return {
		id,
		n,
		trigger: "prompt",
		t0: T0,
		t1: T0 + 39_000,
		duration: { value: 39_000, origin: "counted" },
		userWait: { value: 0, origin: "approximated" },
		llmCalls: { value: 2, origin: "counted" },
		toolCalls: { value: 2, origin: "counted" },
		errors: { value: 1, origin: "counted" },
		subagents: { value: 1, origin: "counted" },
		tokens: {
			value: { input: 2, output: 4, cacheRead: 6, cacheWrite: 8, total: 20 },
			origin: "recorded",
		},
		cost: { value: 0.02, origin: "recorded" },
		...extra,
	};
}

export function timelineOf(turns: readonly TurnSummary[]): SessionTimeline {
	return {
		revision: "r1",
		start: T0,
		end: T0 + 610_000,
		headline: "cost",
		turns,
		bands: [
			{ t0: T0, t1: T0 + 2_000, actor: "model" },
			{ t0: T0 + 2_000, t1: T0 + 6_000, actor: "model" },
			{ t0: T0 + 6_000, t1: T0 + 30_000, actor: "subagent" },
			{ t0: T0 + 40_000, t1: T0 + 600_000, actor: "user" },
			{ t0: T0 + 600_000, t1: T0 + 610_000, actor: "model" },
		],
		waits: { user: 560_000, model: 16_000, tool: 3_000, subagent: 24_000, background: 0, idle: 0 },
		waitsTotal: { value: 603_000, origin: "approximated" },
		lanes: { toolTracks: 2, subagentTracks: 1, tracks: [{ id: "t2", track: 1 }] },
		context: [
			{ id: "a1", tokens: 10 },
			{ id: "a2", tokens: 30, miss: true },
		],
		peak: { value: 30, origin: "recorded" },
		llmCalls: { value: 3, origin: "counted" },
		limits: [
			{ model: "anthropic/claude-test", value: 200, origin: "host", host: 200, observed: 30 },
		],
		spend: [
			{ t: T0 + 6_000, tokens: 10, cost: 0.01 },
			{ t: T0 + 40_000, tokens: 20, cost: 0.02 },
		],
		withSubagents: [
			{ t: T0 + 6_000, tokens: 10, cost: 0.01 },
			{ t: T0 + 30_000, tokens: 110, cost: 0.11 },
			{ t: T0 + 40_000, tokens: 120, cost: 0.12 },
		],
		cacheTtlMs: 300_000,
	};
}
