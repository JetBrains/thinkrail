import { cn, remixicon, type SurfaceProps, ui } from "@thinkrail/ext/view";
import { useState } from "react";
import { AgentDetail } from "./agent-detail";
import { useCancel, useNow, useRun, useRuns } from "./hooks";
import {
	type AgentRow,
	countAgents,
	formatCost,
	formatDuration,
	formatTokens,
	type PhaseRow,
	runUsage,
	tokensOf,
	type WorkflowRun,
} from "./model";
import {
	AGENT_TONE,
	agentsText,
	CostText,
	Empty,
	ProgressBar,
	RunStatusLabel,
	Stat,
	StatusDot,
	WorkflowIcon,
} from "./parts";

const { RiStopCircleLine } = remixicon;

const AgentCard = ({
	agent,
	run,
	now,
	selected,
	onSelect,
}: {
	agent: AgentRow;
	run: WorkflowRun;
	now: number;
	selected: boolean;
	onSelect: () => void;
}) => {
	const runEnd = run.endedAt ?? now;
	const span = Math.max(1, runEnd - run.startedAt);
	const start = agent.startedAt ?? agent.queuedAt;
	const end = agent.endedAt ?? (agent.state === "queued" ? start : now);
	const left = ((start - run.startedAt) / span) * 100;
	const width = Math.max(1, ((end - start) / span) * 100);
	const tone = AGENT_TONE[agent.state];
	return (
		<button
			type="button"
			data-testid="ultracode-agent"
			data-state={agent.state}
			aria-pressed={selected}
			onClick={onSelect}
			className={cn(
				"flex w-full flex-col gap-4 rounded-md border bg-container-elevated-bg px-8 py-8 text-left hover:bg-control-bg-hovered",
				selected ? "border-control-border-active" : "border-border-muted",
			)}
		>
			<span className="flex min-w-0 items-center gap-8">
				<StatusDot state={agent.state} />
				<span className="min-w-0 flex-1 truncate tr-text-ui text-text-default" title={agent.label}>
					{agent.label}
				</span>
				<span className="shrink-0 tabular-nums tr-text-metadata text-text-muted">
					{formatCost(agent.usage.cost)}
				</span>
			</span>
			<span className="flex min-w-0 items-center gap-8 tr-text-metadata text-text-subtle">
				<span className={cn("shrink-0", tone.text)}>
					{agent.replayed ? "replayed" : tone.label}
				</span>
				<span className="min-w-0 flex-1 truncate">
					{agent.state === "running" ? (agent.activity ?? agent.model ?? "") : (agent.model ?? "")}
				</span>
				<span className="shrink-0 tabular-nums">
					{agent.startedAt === undefined ? "" : formatDuration(end - agent.startedAt)}
				</span>
			</span>
			<span className="relative h-2 w-full rounded-sm bg-control-bg">
				<span
					className={cn("absolute top-0 h-2 rounded-sm", tone.bg)}
					style={{ left: `${left}%`, width: `${Math.min(width, 100 - left)}%` }}
				/>
			</span>
		</button>
	);
};

const PhaseColumn = ({
	phase,
	agents,
	run,
	now,
	selected,
	onSelect,
}: {
	phase: PhaseRow;
	agents: AgentRow[];
	run: WorkflowRun;
	now: number;
	selected: number | undefined;
	onSelect: (index: number) => void;
}) => {
	const counts = countAgents(agents);
	return (
		<section
			data-testid="ultracode-phase"
			className="flex w-[260px] shrink-0 flex-col gap-8 rounded-lg border border-border-muted bg-container-content-bg p-8"
		>
			<header className="flex flex-col gap-2 px-4">
				<span className="flex items-center gap-8">
					<span className="min-w-0 flex-1 truncate tr-title-compact text-text-default">
						{phase.title}
					</span>
					<span className="shrink-0 tabular-nums tr-text-metadata text-text-muted">
						{counts.done}/{counts.total}
					</span>
				</span>
				{phase.detail && <span className="tr-text-metadata text-text-subtle">{phase.detail}</span>}
			</header>
			<div className="flex min-h-0 flex-col gap-4 overflow-auto">
				{agents.map((agent) => (
					<AgentCard
						key={agent.index}
						agent={agent}
						run={run}
						now={now}
						selected={selected === agent.index}
						onSelect={() => onSelect(agent.index)}
					/>
				))}
				{agents.length === 0 && (
					<p className="px-4 tr-text-metadata text-text-subtle">No agents yet.</p>
				)}
			</div>
		</section>
	);
};

const RunView = ({ run }: { run: WorkflowRun }) => {
	const running = run.status === "running";
	const now = useNow(500, running);
	const cancel = useCancel();
	const [selected, setSelected] = useState<number | undefined>();
	const counts = countAgents(run.agents);
	const usage = runUsage(run);
	const agent = run.agents.find((each) => each.index === selected);
	return (
		<div
			data-testid="ultracode-run"
			data-status={run.status}
			className="flex h-full min-h-0 flex-col"
		>
			<header className="flex shrink-0 flex-col gap-12 border-b border-border-muted px-16 py-12">
				<div className="flex min-w-0 items-center gap-8">
					<WorkflowIcon className="size-16 shrink-0 text-text-muted" />
					<span
						data-testid="ultracode-run-name"
						className="min-w-0 truncate tr-title-section text-text-default"
					>
						{run.name}
					</span>
					<RunStatusLabel status={run.status} />
					<span className="tr-code-text text-text-subtle">{run.runId}</span>
					<span className="ml-auto" />
					{running && (
						<ui.Button
							variant="outline"
							size="sm"
							data-testid="ultracode-cancel"
							onClick={() => cancel(run.runId)}
						>
							<RiStopCircleLine className="size-14" /> Cancel
						</ui.Button>
					)}
				</div>
				{run.description && <p className="tr-text-metadata text-text-muted">{run.description}</p>}
				<div className="flex flex-wrap items-end gap-24">
					<Stat label="Agents">{agentsText(counts)}</Stat>
					<Stat label="Running">{counts.running}</Stat>
					<Stat label="Failed">{counts.failed + counts.aborted}</Stat>
					<Stat label="Tokens">{formatTokens(tokensOf(usage))}</Stat>
					<Stat label="Cost">
						<CostText cost={usage.cost} maxCost={run.limits.maxCost} />
					</Stat>
					<Stat label="Time">{formatDuration((run.endedAt ?? now) - run.startedAt)}</Stat>
					<Stat label="Concurrency">{run.limits.concurrency}</Stat>
					{run.resumedFrom && <Stat label="Resumed from">{run.resumedFrom}</Stat>}
				</div>
				<ProgressBar counts={counts} />
				{run.error && (
					<p
						data-testid="ultracode-run-error"
						className="rounded-sm bg-feedback-error-subtle px-8 py-4 tr-text-metadata text-text-default"
					>
						{run.error}
					</p>
				)}
			</header>
			<div className="flex min-h-0 flex-1">
				<div className="flex min-w-0 flex-1 flex-col gap-12 overflow-auto p-12">
					<div className="flex min-h-0 gap-12">
						{run.phases.map((phase) => (
							<PhaseColumn
								key={phase.index}
								phase={phase}
								agents={run.agents.filter((each) => each.phaseIndex === phase.index)}
								run={run}
								now={now}
								selected={selected}
								onSelect={setSelected}
							/>
						))}
						{run.phases.length === 0 && <Empty title="No phase has started yet." />}
					</div>
					<section className="flex flex-col gap-4">
						<h3 className="tr-text-metadata text-text-muted">Log</h3>
						<pre
							data-testid="ultracode-log"
							className="max-h-[220px] overflow-auto whitespace-pre-wrap break-words rounded-md border border-border-muted bg-container-elevated-bg px-12 py-8 tr-code-text text-text-muted"
						>
							{run.logs.join("\n") || "No log lines."}
						</pre>
					</section>
				</div>
				{agent && (
					<AgentDetail
						agent={agent}
						phase={run.phases.find((phase) => phase.index === agent.phaseIndex)}
						now={now}
						onClose={() => setSelected(undefined)}
					/>
				)}
			</div>
		</div>
	);
};

const RunTab = ({ params }: SurfaceProps) => {
	const runs = useRuns();
	const runId = params?.runId ?? runs?.[0]?.runId;
	const run = useRun(runId);
	return (
		<div className="flex h-full min-h-0 flex-col bg-container-workspace-bg">
			{run ? (
				<RunView key={run.runId} run={run} />
			) : (
				<Empty
					title={
						runs === undefined
							? "Loading…"
							: !runId
								? "No workflow runs yet."
								: runs.some((each) => each.runId === runId)
									? "Loading the run…"
									: "This run is no longer kept."
					}
					detail="Ask the agent to use the Ultracode tool to fan work out to many subagents."
				/>
			)}
		</div>
	);
};

export default RunTab;
