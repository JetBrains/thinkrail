import type { DelegationRunDetails, DelegationRunStatus } from "@thinkrail/contracts";
import { isDelegationRunDetails } from "@thinkrail/contracts";
import { formatCost, formatElapsed, formatTokens } from "../../SessionStatsBar";
import type { ToolRenderProps } from "../../toolRegistry";
import { strArg } from "../toolHelpers";

export function readRunDetails(value: unknown): DelegationRunDetails | undefined {
	if (!value || typeof value !== "object" || !("details" in value)) return undefined;
	const details = (value as { details: unknown }).details;
	return isDelegationRunDetails(details) ? details : undefined;
}

export function isTerminalRunStatus(status: DelegationRunStatus): boolean {
	return status === "completed" || status === "error" || status === "aborted";
}

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
