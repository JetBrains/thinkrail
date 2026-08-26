// Pure readers/derivers over the `DelegationRunDetails` DTO (the pi-delegation mirror in contracts):
// the defensive result narrowing, the counters line, the collapsed-header summary, and the run-status
// lookup ChatView's transcript polling keys on. No React — unit-tested in runDetails.test.ts.

import type { DelegationRunDetails, DelegationRunStatus } from "@thinkrail/contracts";
import { formatCost, formatElapsed, formatTokens } from "../../formatters";
import type { ToolRenderProps } from "../../toolRegistry";
import type { ChatTurn, ToolResultState } from "../../types";
import { strArg } from "../toolHelpers";

/**
 * Narrow a tool `result`/`partialResult` (an AgentToolResult-shaped `unknown`) to its
 * `DelegationRunDetails`, or `undefined` when the shape doesn't hold — a thrown foreground error
 * carries `details: {}`, and the wire is untrusted, so every read goes through this.
 */
export function readRunDetails(value: unknown): DelegationRunDetails | undefined {
	if (!value || typeof value !== "object" || !("details" in value)) return undefined;
	const details = (value as { details: unknown }).details;
	if (!details || typeof details !== "object") return undefined;
	const d = details as Partial<DelegationRunDetails>;
	return typeof d.childSessionId === "string" &&
		typeof d.status === "string" &&
		typeof d.task === "string" &&
		typeof d.usage === "object" &&
		d.usage !== null
		? (details as DelegationRunDetails)
		: undefined;
}

/** The three states a run never leaves. */
export function isTerminalRunStatus(status: DelegationRunStatus): boolean {
	return status === "completed" || status === "error" || status === "aborted";
}

/**
 * The ticking counters of a run — "3 turns · 30.4k tok · $0.04 · 45s" pieces, zeros skipped.
 * `tokens: "split"` renders "in 25.1k / out 5.3k" instead of the total (the expanded card's meta line).
 */
export function runCounters(
	details: DelegationRunDetails,
	tokens: "total" | "split" = "total",
): string[] {
	const parts: string[] = [];
	const u = details.usage;
	if (u.turns > 0) parts.push(`${u.turns} ${u.turns === 1 ? "turn" : "turns"}`);
	if (u.input > 0 || u.output > 0) {
		parts.push(
			tokens === "split"
				? `in ${formatTokens(u.input)} / out ${formatTokens(u.output)}`
				: `${formatTokens(u.input + u.output)} tok`,
		);
	}
	if (u.cost > 0) parts.push(formatCost(u.cost));
	if (details.durationMs > 0) parts.push(formatElapsed(details.durationMs));
	return parts;
}

/**
 * The collapsed-header line for `Agent` / `get_subagent_result` cards — the Claude Code convention:
 * the collapsed row itself is live. Role + non-obvious status words (the chrome's icon already says
 * running/done/error) + ticking counters + the current step while running; before the first
 * `partialResult` lands (or for a thrown foreground error, whose details are empty) it falls back to
 * the call's own args.
 */
export function agentSummary({ args, result }: ToolRenderProps): string {
	const details = readRunDetails(result);
	if (!details) {
		const role = strArg(args, "subagent_type") || strArg(args, "session_id");
		const task = strArg(args, "task");
		return role && task ? `${role}: ${task}` : role || task;
	}
	const parts = [details.roleName ?? "subagent"];
	if (details.status === "queued") parts.push("queued");
	if (details.status === "aborted") parts.push("aborted");
	if (args.run_in_background === true && !isTerminalRunStatus(details.status)) {
		parts.push("background");
	}
	parts.push(...runCounters(details));
	if (details.status === "running" && details.activity) parts.push(details.activity);
	return parts.join(" · ");
}

/**
 * A child run's current status as this chat's runtime knows it: the latest `DelegationRunDetails`
 * carried by any tool result (Agent / get_subagent_result — REPLACE snapshots, so the newest matching
 * entry wins), overridden by a `subagentCompletion` turn (the terminal signal for a background run,
 * whose tool result froze at the ack). `undefined` when this chat never saw the child — e.g. after a
 * reload, where hydrated tool results still carry the details, but an unknown id stays unknown.
 * ChatView keys the transcript dialog's polling on this.
 */
export function delegationRunStatus(
	turns: ChatTurn[],
	toolResults: Record<string, ToolResultState>,
	childSessionId: string,
): DelegationRunStatus | undefined {
	for (let i = turns.length - 1; i >= 0; i--) {
		const turn = turns[i];
		if (turn?.kind === "subagentCompletion" && turn.details.childSessionId === childSessionId) {
			return turn.details.status;
		}
	}
	let latest: DelegationRunStatus | undefined;
	for (const state of Object.values(toolResults)) {
		const details = readRunDetails(state.raw);
		if (details?.childSessionId === childSessionId) latest = details.status;
	}
	return latest;
}
