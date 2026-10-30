import {
	RiArrowDownSLine,
	RiArrowUpSLine,
	RiCheckLine,
	RiLoader4Line,
	RiRobot2Line,
	RiTerminalBoxLine,
} from "@remixicon/react";
import type { BackgroundCommandSummary, SubagentResourceSummary } from "@thinkrail/contracts";
import { useT } from "@thinkrail/locales/react";
import { cn } from "@thinkrail/ui/utils";
import { useState } from "react";
import {
	actionKey,
	type Resource,
	type ResourceActions,
	ResourceRow,
	resourceId,
	sortLive,
	toResources,
} from "./resourceRow";

const EXPANDED_ROW_LIMIT = 4;

export function ResourcesDock({
	commands,
	subagents,
	finishedCount,
	freshCount = 0,
	now,
	authoritative,
	actions,
	onInspect,
	onOpenFinished,
	onStopCommand,
	onStopSubagent,
}: {
	commands: BackgroundCommandSummary[];
	subagents: SubagentResourceSummary[];
	finishedCount: number;
	freshCount?: number;
	now: number;
	authoritative: boolean;
	actions: ResourceActions;
	onInspect: (resourceId: string) => void;
	onOpenFinished: () => void;
	onStopCommand: (commandId: string) => void;
	onStopSubagent: (childSessionId: string) => void;
}) {
	const t = useT();
	const stop = (resource: Resource) =>
		resource.kind === "command"
			? onStopCommand(resource.summary.id)
			: onStopSubagent(resource.summary.childSessionId);
	const [collapsedChoice, setCollapsedChoice] = useState<boolean | null>(null);
	const rows = sortLive(toResources(commands, subagents));
	if (rows.length === 0 && finishedCount === 0) return null;
	const collapsible = rows.length > EXPANDED_ROW_LIMIT;
	const collapsed = collapsible && (collapsedChoice ?? true);
	const Chevron = collapsed ? RiArrowUpSLine : RiArrowDownSLine;
	const activeLabel = (
		<>
			{!authoritative ? (
				<RiLoader4Line className="size-12 shrink-0 animate-spin motion-reduce:animate-none" />
			) : (
				<span
					aria-hidden
					className="size-6 shrink-0 rounded-full bg-primary motion-safe:animate-working"
				/>
			)}
			<span>
				{authoritative
					? t("resources.dock.active", { count: rows.length })
					: t("resources.dock.activeReconnecting", { count: rows.length })}
			</span>
		</>
	);
	const lineClass =
		"flex min-h-28 min-w-0 items-center gap-8 rounded-sm px-8 text-text-muted tr-text-metadata";
	const controlClass =
		"outline-none hover:bg-control-bg-hovered hover:text-text-default focus-visible:ring-2 focus-visible:ring-primary";
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
							onSelect={() => onInspect(resourceId(resource))}
							onStop={() => stop(resource)}
						/>
					))}
				</ul>
			)}
			{collapsible || finishedCount > 0 || (!authoritative && rows.length > 0) ? (
				<div className="flex min-w-0 items-center gap-4">
					{collapsible ? (
						<button
							type="button"
							data-testid="resources-dock-toggle"
							aria-expanded={!collapsed}
							onClick={() => setCollapsedChoice(!collapsed)}
							className={cn(lineClass, controlClass, "shrink-0")}
						>
							{activeLabel}
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
							<Chevron className="size-14 shrink-0" />
						</button>
					) : !authoritative && rows.length > 0 ? (
						<span className={cn(lineClass, "shrink-0")}>{activeLabel}</span>
					) : null}
					{finishedCount > 0 ? (
						<button
							type="button"
							data-testid="resources-dock-finished"
							onClick={onOpenFinished}
							className={cn(lineClass, controlClass, "flex-1")}
						>
							<RiCheckLine className="size-14 shrink-0" />
							<span className="whitespace-nowrap">
								{t("resources.dock.finished", { count: finishedCount })}
							</span>
							{freshCount > 0 ? (
								<>
									<span aria-hidden className="text-text-subtle">
										·
									</span>
									<span
										data-testid="resources-dock-fresh"
										className="whitespace-nowrap text-primary"
									>
										{t("resources.dock.fresh", { count: freshCount })}
									</span>
								</>
							) : null}
							<span className="flex-1" />
							<span className="truncate text-text-subtle">{t("resources.dock.open")}</span>
						</button>
					) : null}
				</div>
			) : null}
		</div>
	);
}
