// Derailment protection — a run that goes sideways must die fast and diagnosed, not burn tokens until
// the test timeout. Two layers (../SPEC.md § watchdog):
// - Deterministic budget tripwires (defaults on every scenario): max turns / tool calls / wall time.
// - Optional cheap-LLM on-track assessment between turns.
// A watchdog abort NEVER fails a test by itself — the test fails deterministically because its stopWhen
// never fired; the watchdog only makes that failure fast and carries the diagnosis.
import "./env";
import { completeOnce } from "@thinkrail/server/agent";
import type { EventLog } from "./events";

export interface WatchdogBudget {
	maxTurns: number;
	maxToolCalls: number;
	maxMs: number;
}

export const DEFAULT_BUDGET: WatchdogBudget = {
	maxTurns: 8,
	maxToolCalls: 60,
	maxMs: 180_000,
};

export interface WatchdogConfig {
	budget?: Partial<WatchdogBudget>;
	/** When set, a cheap LLM assesses "still on track toward this?" between turns. */
	intent?: string;
}

/** Deterministic tripwire check. Pure (unit-tested). Returns a reason, or null when within budget. */
export function checkBudget(
	log: EventLog,
	startedAt: number,
	budget: WatchdogBudget,
	now = Date.now(),
): string | null {
	if (log.turnCount() >= budget.maxTurns) return `budget: ${budget.maxTurns} turns reached`;
	if (log.toolCalls().length >= budget.maxToolCalls)
		return `budget: ${budget.maxToolCalls} tool calls reached`;
	if (now - startedAt >= budget.maxMs) return `budget: ${budget.maxMs}ms wall time reached`;
	return null;
}

/** Parse the on-track reply. Pure (unit-tested). Unparseable → on-track (never kill a run on judge flake). */
export function parseOnTrackReply(reply: string): { onTrack: boolean; reason: string } {
	const jsonMatch = reply.match(/\{[\s\S]*\}/);
	if (!jsonMatch) return { onTrack: true, reason: "unparseable watchdog reply — assumed on track" };
	try {
		const parsed = JSON.parse(jsonMatch[0]) as { onTrack?: boolean; reason?: string };
		if (typeof parsed.onTrack !== "boolean")
			return { onTrack: true, reason: "unparseable watchdog reply — assumed on track" };
		return { onTrack: parsed.onTrack, reason: String(parsed.reason ?? "") };
	} catch {
		return { onTrack: true, reason: "unparseable watchdog reply — assumed on track" };
	}
}

const WATCHDOG_SYSTEM = [
	"You supervise an automated test run of a coding agent. Given the run's intent and the transcript",
	"tail, decide whether the agent is still plausibly working toward the intent.",
	'Reply ONLY JSON: {"onTrack": true|false, "reason": "<one line>"}. Be lenient — flag only clear',
	"derailment (loops, unrelated work, rambling).",
].join(" ");

/** The between-turns LLM assessment. Any error → on-track (the budget tripwires still bind). */
export async function assessOnTrack(
	log: EventLog,
	intent: string,
): Promise<{ onTrack: boolean; reason: string }> {
	try {
		const transcript = log.renderTranscript();
		const tail = transcript.length > 4000 ? transcript.slice(-4000) : transcript;
		const { text } = await completeOnce({
			system: WATCHDOG_SYSTEM,
			prompt: `Intent: ${intent}\n\nTranscript tail:\n${tail}`,
			tier: "cheap",
			maxTokens: 128,
		});
		return parseOnTrackReply(text);
	} catch {
		return { onTrack: true, reason: "watchdog model unavailable — assumed on track" };
	}
}
