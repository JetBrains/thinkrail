import { openSurface, remixicon, ui } from "@thinkrail/ext/view";
import { useCancel, useForget, useNow, useRuns } from "./hooks";
import { EXT_NAME, formatDuration, type RunSummary } from "./model";
import { agentsText, CostText, Empty, ProgressBar, RunStatusLabel } from "./parts";

const { RiDeleteBinLine, RiExternalLinkLine, RiStopCircleLine } = remixicon;

const RunRow = ({ run, now }: { run: RunSummary; now: number }) => {
	const cancel = useCancel();
	const forget = useForget();
	const running = run.status === "running";
	return (
		<li
			data-testid="ultracode-row"
			data-status={run.status}
			className="flex flex-col gap-8 rounded-md border border-border-muted bg-container-elevated-bg p-12"
		>
			<div className="flex min-w-0 items-center gap-8">
				<button
					type="button"
					data-testid="ultracode-row-open"
					onClick={() => openSurface(EXT_NAME, "run", { runId: run.runId })}
					className="min-w-0 flex-1 truncate text-left tr-text-ui text-text-default hover:text-primary"
					title={`Open ${run.name}`}
				>
					{run.name}
				</button>
				<RunStatusLabel status={run.status} />
			</div>
			<ProgressBar counts={run.counts} />
			<div className="flex flex-wrap items-center gap-8 tr-text-metadata text-text-muted">
				<span className="tabular-nums">{agentsText(run.counts)}</span>
				{run.counts.failed > 0 && (
					<span className="text-feedback-error">{run.counts.failed} failed</span>
				)}
				<CostText cost={run.cost} maxCost={run.maxCost} />
				<span className="tabular-nums">{formatDuration((run.endedAt ?? now) - run.startedAt)}</span>
				{running && run.phase && <span className="truncate text-primary">{run.phase}</span>}
				<span className="ml-auto flex items-center gap-4">
					<ui.IconTooltip label="Open the run">
						<ui.Button
							variant="ghost"
							size="icon"
							aria-label="Open the run"
							onClick={() => openSurface(EXT_NAME, "run", { runId: run.runId })}
						>
							<RiExternalLinkLine className="size-14" />
						</ui.Button>
					</ui.IconTooltip>
					{running ? (
						<ui.IconTooltip label="Cancel the run and its agents">
							<ui.Button
								variant="ghost"
								size="icon"
								aria-label="Cancel the run"
								data-testid="ultracode-row-cancel"
								onClick={() => cancel(run.runId)}
							>
								<RiStopCircleLine className="size-14 text-feedback-error" />
							</ui.Button>
						</ui.IconTooltip>
					) : (
						<ui.IconTooltip label="Remove from the list">
							<ui.Button
								variant="ghost"
								size="icon"
								aria-label="Remove the run"
								data-testid="ultracode-row-forget"
								onClick={() => forget(run.runId)}
							>
								<RiDeleteBinLine className="size-14" />
							</ui.Button>
						</ui.IconTooltip>
					)}
				</span>
			</div>
		</li>
	);
};

const Group = ({ title, runs, now }: { title: string; runs: RunSummary[]; now: number }) =>
	runs.length === 0 ? null : (
		<section className="flex flex-col gap-8">
			<h3 className="tr-text-metadata text-text-muted">
				{title} · {runs.length}
			</h3>
			<ul className="flex flex-col gap-8">
				{runs.map((run) => (
					<RunRow key={run.runId} run={run} now={now} />
				))}
			</ul>
		</section>
	);

const Workflows = () => {
	const runs = useRuns();
	const running = runs?.filter((run) => run.status === "running") ?? [];
	const finished = runs?.filter((run) => run.status !== "running") ?? [];
	const now = useNow(1_000, running.length > 0);
	return (
		<div
			data-testid="ultracode-workflows"
			className="flex h-full min-h-0 flex-col gap-16 overflow-auto p-12"
		>
			{runs && runs.length === 0 && (
				<Empty
					title="No workflow runs yet."
					detail="Ask the agent to use the Ultracode tool to fan work out to many subagents."
				/>
			)}
			<Group title="Running" runs={running} now={now} />
			<Group title="Finished" runs={finished} now={now} />
		</div>
	);
};

export default Workflows;
