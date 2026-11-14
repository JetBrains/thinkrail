import type { DelegationRunDetails, DelegationRunStatus } from "@thinkrail/contracts";
import { isDelegationRunDetails } from "@thinkrail/contracts";
import { strArg, type ToolRenderProps } from "@thinkrail/extension-api/web";
import type { Translator } from "@thinkrail/locales/react";
import { formatCost, formatElapsed, formatTokens } from "../../SessionStatsBar";

export function readRunDetails(value: unknown): DelegationRunDetails | undefined {
	if (!value || typeof value !== "object" || !("details" in value)) return undefined;
	const details = value.details;
	return isDelegationRunDetails(details) ? details : undefined;
}

export function isTerminalRunStatus(status: DelegationRunStatus): boolean {
	return status === "completed" || status === "error" || status === "aborted";
}

export function usageCounters(
	t: Translator,
	details: DelegationRunDetails,
	tokens: "total" | "split" = "total",
): string[] {
	const parts: string[] = [];
	const u = details.usage;
	if (u.turns > 0) parts.push(t("tools.agent.turns", { count: u.turns }));
	if (u.input > 0 || u.output > 0) {
		parts.push(
			tokens === "split"
				? t("tools.agent.tokensSplit", {
						input: formatTokens(u.input),
						output: formatTokens(u.output),
					})
				: t("tools.agent.tokensTotal", { tokens: formatTokens(u.input + u.output) }),
		);
	}
	if (u.cost > 0) parts.push(formatCost(u.cost));
	return parts;
}

export function runCounters(
	t: Translator,
	details: DelegationRunDetails,
	tokens: "total" | "split" = "total",
): string[] {
	const parts = usageCounters(t, details, tokens);
	if (details.durationMs > 0) parts.push(formatElapsed(t, details.durationMs));
	return parts;
}

const COMPLETION_HEADER = /^Subagent "[^"\n]*" \([^)\n]*\) \w+:\n\n/;

export function completionReport(text: string): string {
	return text.replace(COMPLETION_HEADER, "").trim();
}

export function reportTeaser(report: string): string {
	for (const raw of report.split("\n")) {
		const line = raw
			.trim()
			.replace(/^(?:#{1,6}\s+|>\s*|[-*+]\s+|\d+[.)]\s+)/, "")
			.replace(/\*\*|__|`/g, "")
			.trim();
		if (line) return line;
	}
	return "";
}

export function agentSummary({ args, result }: ToolRenderProps, t: Translator): string {
	const details = readRunDetails(result);
	if (!details) {
		const role = strArg(args, "subagent_type") || strArg(args, "session_id");
		const task = strArg(args, "task");
		return role && task ? t("tools.agent.summaryRoleTask", { role, task }) : role || task;
	}
	const parts = [details.roleName ?? t("tools.agent.fallbackRole")];
	if (details.status === "queued") parts.push(t("tools.agent.summaryQueued"));
	if (details.status === "aborted") parts.push(t("tools.agent.summaryAborted"));
	if (args.run_in_background === true && !isTerminalRunStatus(details.status)) {
		parts.push(t("tools.agent.summaryBackground"));
	}
	parts.push(...runCounters(t, details));
	if (details.status === "running" && details.activity) parts.push(details.activity);
	return parts.join(" · ");
}
