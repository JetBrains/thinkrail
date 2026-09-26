import { openSurface, remixicon, type SurfaceProps, ui } from "@thinkrail/ext/view";
import { useNow, useRuns } from "./hooks";
import { EXT_NAME, formatDuration, isRecord, isRunSummary } from "./model";
import { agentsText, CostText, ProgressBar, RunStatusLabel, WorkflowIcon } from "./parts";

const { RiExternalLinkLine, RiLoader4Line } = remixicon;

const detailsOf = (value: unknown) =>
	isRecord(value) && "details" in value ? value.details : value;

const textOf = (value: unknown) => {
	if (!isRecord(value) || !Array.isArray(value.content)) return undefined;
	const block: unknown = value.content[0];
	return isRecord(block) && typeof block.text === "string" ? block.text : undefined;
};

const scriptName = (args: Record<string, unknown>) => {
	const script = typeof args.script === "string" ? args.script : "";
	return /\bname\s*:\s*['"`]([^'"`]+)['"`]/.exec(script)?.[1];
};

const WorkflowCard = ({ toolCall }: SurfaceProps) => {
	const details = detailsOf(toolCall?.result);
	const fromTool = isRunSummary(details) ? details : undefined;
	const live = useRuns()?.find((run) => run.runId === fromTool?.runId);
	const summary = toolCall?.status === "running" ? (live ?? fromTool) : (fromTool ?? live);
	const now = useNow(1_000, toolCall?.status === "running");
	if (!toolCall) return null;
	const name = summary?.name ?? scriptName(toolCall.args) ?? "workflow";
	return (
		<div
			data-testid="ultracode-card"
			data-state={summary?.status ?? toolCall.status}
			className="flex flex-col gap-8 rounded-md border border-border-muted bg-container-elevated-bg px-12 py-8"
		>
			<div className="flex min-w-0 items-center gap-8 tr-text-ui">
				{toolCall.status === "running" ? (
					<RiLoader4Line className="size-14 shrink-0 animate-spin text-primary" />
				) : (
					<WorkflowIcon className="size-14 shrink-0 text-text-muted" />
				)}
				<span className="shrink-0 text-text-muted">Workflow</span>
				<span data-testid="ultracode-card-name" className="min-w-0 truncate text-text-default">
					{name}
				</span>
				<span className="ml-auto" />
				{summary && summary.status !== "running" && <RunStatusLabel status={summary.status} />}
				{summary && (
					<ui.IconTooltip label="Open the run">
						<ui.Button
							variant="ghost"
							size="icon"
							aria-label="Open the run"
							data-testid="ultracode-card-open"
							onClick={() => openSurface(EXT_NAME, "run", { runId: summary.runId })}
						>
							<RiExternalLinkLine className="size-14" />
						</ui.Button>
					</ui.IconTooltip>
				)}
			</div>
			{summary && (
				<>
					<ProgressBar counts={summary.counts} />
					<div className="flex flex-wrap items-center gap-8 tr-text-metadata text-text-muted">
						{summary.status === "running" && summary.phase && (
							<span data-testid="ultracode-card-phase" className="truncate text-primary">
								{summary.phase}
							</span>
						)}
						<span data-testid="ultracode-card-agents" className="tabular-nums">
							{agentsText(summary.counts)}
						</span>
						{summary.counts.failed > 0 && (
							<span className="text-feedback-error">{summary.counts.failed} failed</span>
						)}
						{summary.counts.replayed > 0 && <span>{summary.counts.replayed} replayed</span>}
						<CostText cost={summary.cost} maxCost={summary.maxCost} />
						<span className="tabular-nums">
							{formatDuration((summary.endedAt ?? now) - summary.startedAt)}
						</span>
					</div>
				</>
			)}
			{!summary && toolCall.status === "error" && (
				<p className="tr-text-metadata whitespace-pre-wrap text-feedback-error">
					{textOf(toolCall.result) ?? "The workflow failed to start."}
				</p>
			)}
		</div>
	);
};

export default WorkflowCard;
