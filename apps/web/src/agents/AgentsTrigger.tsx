import {
	RiAlertLine,
	RiCheckLine,
	RiLoader4Line,
	RiRobot2Line,
	RiTimeLine,
} from "@remixicon/react";
import type { SubagentRosterRow } from "@thinkrail/contracts";
import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@thinkrail/ui/popover";
import { cn } from "@thinkrail/ui/utils";
import {
	type AgentGroupId,
	formatAgentElapsed,
	formatAgentTokens,
	groupRoster,
	isStoppableAgent,
} from "./groupRoster";
import { useSubagentRoster } from "./useSubagentRoster";

const GROUP_ICON = {
	failed: RiAlertLine,
	working: RiLoader4Line,
	queued: RiTimeLine,
	done: RiCheckLine,
} as const;

const GROUP_TONE: Record<AgentGroupId, string> = {
	failed: "text-feedback-error",
	working: "text-text-default",
	queued: "text-text-muted",
	done: "text-text-muted",
};

function AgentRow({
	row,
	group,
	onStop,
}: {
	row: SubagentRosterRow;
	group: AgentGroupId;
	onStop: () => void;
}) {
	const t = useT();
	const Icon = GROUP_ICON[group];
	const tokens = formatAgentTokens(row);
	const detail =
		group === "failed"
			? (row.errorMessage ?? row.abortReason)
			: group === "working"
				? row.activity
				: group === "queued"
					? t("agents.row.waiting")
					: undefined;
	return (
		<li
			className="flex items-start gap-8 px-12 py-8"
			data-testid="agents-row"
			data-group={group}
			data-child-session-id={row.childSessionId}
		>
			<Icon
				aria-hidden="true"
				className={cn(
					"mt-2 size-16 shrink-0",
					GROUP_TONE[group],
					group === "working" && "motion-safe:animate-spin",
				)}
			/>
			<div className="min-w-0 flex-1">
				<div className="flex min-w-0 items-baseline gap-8">
					<span className="shrink-0 tr-text-emphasis">{row.roleName ?? t("agents.row.agent")}</span>
					<span className="truncate text-text-muted">{row.task}</span>
				</div>
				<div className="flex min-w-0 flex-wrap items-center gap-x-8 tr-text-metadata text-text-muted">
					<span className={cn(GROUP_TONE[group])}>{t(`agents.group.${group}`)}</span>
					{detail ? <span className="truncate">{detail}</span> : null}
					<span className="truncate">{row.parentTitle || t("agents.row.untitledChat")}</span>
					{row.durationMs !== undefined ? <span>{formatAgentElapsed(row.durationMs)}</span> : null}
					{tokens ? <span className="tabular-nums">{tokens}</span> : null}
					{row.usage && row.usage.cost > 0 ? (
						<span className="tabular-nums">${row.usage.cost.toFixed(2)}</span>
					) : null}
				</div>
			</div>
			{isStoppableAgent(row) ? (
				<Button variant="ghost" size="s" onClick={onStop} data-testid="agents-stop">
					{t("agents.row.stop")}
				</Button>
			) : null}
		</li>
	);
}

/** Chat-header trigger and popover for every subagent in this workspace, across chats. */
export function AgentsTrigger({ workspaceId }: { workspaceId: string }) {
	const t = useT();
	const { supported, roster, stop } = useSubagentRoster(workspaceId);
	if (!supported || !roster || roster.rows.length === 0) return null;
	const live = roster.counts.queued + roster.counts.running;
	const groups = groupRoster(roster.rows);
	return (
		<Popover>
			<PopoverTrigger asChild>
				<Button
					variant="ghost"
					size="m"
					iconLeft={RiRobot2Line}
					className={cn("shrink-0", live > 0 && "motion-safe:animate-working")}
					data-testid="agents-trigger"
					data-live-count={live}
					data-failed-count={roster.counts.failed}
					aria-label={t("agents.trigger.aria", { count: live })}
				>
					<span className="hidden @[480px]:inline">{t("agents.trigger.label")}</span>
					<span className="tabular-nums">{live}</span>
					{roster.counts.failed > 0 ? (
						<RiAlertLine aria-hidden="true" className="size-14 text-feedback-error" />
					) : null}
				</Button>
			</PopoverTrigger>
			<PopoverContent align="end" className="w-[min(32rem,92vw)] p-0" data-testid="agents-popover">
				<div className="max-h-96 overflow-y-auto py-4">
					{groups.map((group) => (
						<section key={group.id} aria-label={t(`agents.group.${group.id}`)}>
							<h3 className="px-12 pt-8 tr-text-metadata text-text-muted">
								{t(`agents.group.${group.id}`)} ({group.rows.length})
							</h3>
							<ul>
								{group.rows.map((row) => (
									<AgentRow
										key={row.childSessionId}
										row={row}
										group={group.id}
										onStop={() => stop(row.parentSessionId, row.childSessionId)}
									/>
								))}
							</ul>
						</section>
					))}
				</div>
			</PopoverContent>
		</Popover>
	);
}
