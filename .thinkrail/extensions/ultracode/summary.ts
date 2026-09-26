import { safeStringify } from "./journal";
import {
	countAgents,
	formatCost,
	formatDuration,
	formatTokens,
	runUsage,
	tokensOf,
	type WorkflowRun,
} from "./model";

const RESULT_CHARS = 12_000;
const LOG_TAIL = 60;

export const liveText = (run: WorkflowRun) => {
	const counts = countAgents(run.agents);
	return [
		`▶ ${run.name} (running) — ${counts.done + counts.failed + counts.aborted}/${counts.total} agents, ${formatCost(runUsage(run).cost)}`,
		...run.logs.slice(-12),
	].join("\n");
};

export const summaryText = (run: WorkflowRun, journalDir: string) => {
	const counts = countAgents(run.agents);
	const usage = runUsage(run);
	const extras = [
		counts.replayed > 0 ? `${counts.replayed} replayed` : "",
		counts.failed > 0 ? `${counts.failed} failed` : "",
		counts.aborted > 0 ? `${counts.aborted} cancelled` : "",
	].filter(Boolean);
	const header =
		`Workflow "${run.name}" ${run.status} — ${counts.total} agents${extras.length > 0 ? ` (${extras.join(", ")})` : ""}, ` +
		`${formatTokens(tokensOf(usage))} tokens, ${formatCost(usage.cost)}, ${formatDuration((run.endedAt ?? run.startedAt) - run.startedAt)} ` +
		`(run ${run.runId}${run.resumedFrom ? `, resumed from ${run.resumedFrom}` : ""}).`;
	const parts = [header, "", "Progress:", run.logs.slice(-LOG_TAIL).join("\n") || "(no output)"];
	if (run.error) parts.push("", `Error: ${run.error}`);
	if (run.result !== undefined) {
		const json = safeStringify(run.result, 2);
		parts.push(
			"",
			"Result:",
			json.length > RESULT_CHARS
				? `${json.slice(0, RESULT_CHARS)}\n… (truncated; the full result is in the Workflow run tab)`
				: json,
		);
	}
	parts.push("", `Journal: ${journalDir}`);
	return parts.join("\n");
};
