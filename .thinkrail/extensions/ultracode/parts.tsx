import { cn, remixicon } from "@thinkrail/ext/view";
import type { ReactNode } from "react";
import { type AgentState, type Counts, formatCost, type RunStatus } from "./model";

const {
	RiCheckboxCircleLine,
	RiCloseCircleLine,
	RiForbidLine,
	RiLoader4Line,
	RiTimeLine,
	RiFlowChart,
} = remixicon;

export const AGENT_TONE = {
	queued: { text: "text-text-subtle", bg: "bg-border-default", label: "queued" },
	running: { text: "text-primary", bg: "bg-primary", label: "running" },
	done: { text: "text-feedback-success", bg: "bg-feedback-success", label: "done" },
	failed: { text: "text-feedback-error", bg: "bg-feedback-error", label: "failed" },
	aborted: { text: "text-feedback-warning", bg: "bg-feedback-warning", label: "cancelled" },
} satisfies Record<AgentState, { text: string; bg: string; label: string }>;

export const RUN_TONE = {
	running: { text: "text-primary", icon: RiLoader4Line, label: "running" },
	completed: { text: "text-feedback-success", icon: RiCheckboxCircleLine, label: "completed" },
	failed: { text: "text-feedback-error", icon: RiCloseCircleLine, label: "failed" },
	aborted: { text: "text-feedback-warning", icon: RiForbidLine, label: "cancelled" },
} satisfies Record<RunStatus, { text: string; icon: unknown; label: string }>;

export const WorkflowIcon = RiFlowChart;
export const QueuedIcon = RiTimeLine;

export const RunStatusLabel = ({ status }: { status: RunStatus }) => {
	const tone = RUN_TONE[status];
	const Icon = tone.icon;
	return (
		<span
			data-testid="ultracode-run-status"
			data-status={status}
			className={cn("flex shrink-0 items-center gap-4 tr-text-ui", tone.text)}
		>
			<Icon className={cn("size-14", status === "running" && "animate-spin")} />
			{tone.label}
		</span>
	);
};

export const StatusDot = ({ state }: { state: AgentState }) => (
	<span
		className={cn(
			"size-8 shrink-0 rounded-full",
			AGENT_TONE[state].bg,
			state === "running" && "animate-pulse",
		)}
	/>
);

export const ProgressBar = ({ counts }: { counts: Counts }) => {
	const total = Math.max(1, counts.total);
	const parts: Array<[AgentState, number]> = [
		["done", counts.done],
		["failed", counts.failed],
		["aborted", counts.aborted],
		["running", counts.running],
	];
	return (
		<div
			data-testid="ultracode-progress"
			className="flex h-4 w-full overflow-hidden rounded-sm bg-control-bg"
		>
			{parts.map(([state, count]) =>
				count > 0 ? (
					<span
						key={state}
						className={AGENT_TONE[state].bg}
						style={{ width: `${(count / total) * 100}%` }}
					/>
				) : null,
			)}
		</div>
	);
};

export const agentsText = (counts: Counts) =>
	`${counts.done + counts.failed + counts.aborted}/${counts.total} agents`;

export const CostText = ({ cost, maxCost }: { cost: number; maxCost?: number | undefined }) => (
	<span
		data-testid="ultracode-cost"
		className={cn(
			"shrink-0 tabular-nums",
			maxCost !== undefined && cost >= maxCost ? "text-feedback-error" : "text-text-muted",
		)}
	>
		{formatCost(cost)}
		{maxCost !== undefined && <span className="text-text-subtle"> / {formatCost(maxCost)}</span>}
	</span>
);

export const Stat = ({ label, children }: { label: string; children: ReactNode }) => (
	<div className="flex flex-col gap-2">
		<span className="tr-text-metadata text-text-subtle">{label}</span>
		<span className="tr-text-ui tabular-nums text-text-default">{children}</span>
	</div>
);

export const Empty = ({ title, detail }: { title: string; detail?: string }) => (
	<div
		data-testid="ultracode-empty"
		className="flex flex-1 flex-col items-center justify-center gap-4 p-24 text-center"
	>
		<p className="tr-text-ui text-text-default">{title}</p>
		{detail && <p className="tr-text-metadata text-text-muted">{detail}</p>}
	</div>
);
