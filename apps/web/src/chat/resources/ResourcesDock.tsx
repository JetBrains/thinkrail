import {
	RiArrowDownSLine,
	RiArrowUpSLine,
	RiLoader4Line,
	RiRobot2Line,
	RiTerminalBoxLine,
} from "@remixicon/react";
import type { BackgroundCommandSummary, SubagentResourceSummary } from "@thinkrail/contracts";
import { useState } from "react";
import { actionKey, type ResourceActions, ResourceRow, sortLive, toResources } from "./resourceRow";

const EXPANDED_ROW_LIMIT = 4;

export function ResourcesDock({
	commands,
	subagents,
	now,
	authoritative,
	actions,
	onInspect,
	onStopCommand,
	onStopSubagent,
}: {
	commands: BackgroundCommandSummary[];
	subagents: SubagentResourceSummary[];
	now: number;
	authoritative: boolean;
	actions: ResourceActions;
	onInspect: (resourceId: string) => void;
	onStopCommand: (commandId: string) => void;
	onStopSubagent: (childSessionId: string) => void;
}) {
	const [collapsedChoice, setCollapsedChoice] = useState<boolean | null>(null);
	const rows = sortLive(toResources(commands, subagents));
	if (rows.length === 0) return null;
	const collapsed = collapsedChoice ?? rows.length > EXPANDED_ROW_LIMIT;
	const Chevron = collapsed ? RiArrowUpSLine : RiArrowDownSLine;
	return (
		<div
			data-testid="resources-dock"
			data-collapsed={collapsed || undefined}
			className="flex shrink-0 flex-col gap-2 border-border-default border-t bg-container-elevated-bg px-12 py-4"
		>
			{collapsed ? null : (
				<ul className="flex flex-col gap-2">
					{rows.map((resource) => (
						<ResourceRow
							key={actionKey(resource)}
							resource={resource}
							now={now}
							authoritative={authoritative}
							action={actions[actionKey(resource)]}
							stopAllPending={!!actions.all?.pending}
							onSelect={() =>
								onInspect(
									resource.kind === "command"
										? resource.summary.id
										: resource.summary.childSessionId,
								)
							}
							onStop={() =>
								resource.kind === "command"
									? onStopCommand(resource.summary.id)
									: onStopSubagent(resource.summary.childSessionId)
							}
						/>
					))}
				</ul>
			)}
			<button
				type="button"
				data-testid="resources-dock-toggle"
				aria-expanded={!collapsed}
				onClick={() => setCollapsedChoice(!collapsed)}
				className="flex min-h-28 w-full items-center gap-8 rounded-[var(--radius-sm)] px-8 text-text-muted tr-text-metadata outline-none hover:bg-control-bg-hovered hover:text-text-default focus-visible:ring-2 focus-visible:ring-primary"
			>
				{authoritative ? (
					<span
						aria-hidden
						className="size-6 shrink-0 rounded-full bg-primary motion-safe:animate-working"
					/>
				) : (
					<RiLoader4Line className="size-12 shrink-0 animate-spin motion-reduce:animate-none" />
				)}
				<span>
					{rows.length} active{authoritative ? "" : " · reconnecting"}
				</span>
				{commands.length > 0 ? (
					<span className="inline-flex items-center gap-4">
						<RiTerminalBoxLine className="size-12" />
						{commands.length}
					</span>
				) : null}
				{subagents.length > 0 ? (
					<span className="inline-flex items-center gap-4">
						<RiRobot2Line className="size-12" />
						{subagents.length}
					</span>
				) : null}
				<span className="flex-1" />
				<span className="text-text-subtle">{collapsed ? "show" : "hide"}</span>
				<Chevron className="size-14 shrink-0" />
			</button>
		</div>
	);
}
