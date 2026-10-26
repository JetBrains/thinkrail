import {
	RiArrowDownSLine,
	RiArrowUpSLine,
	RiLoader4Line,
	RiRobot2Line,
	RiTerminalBoxLine,
} from "@remixicon/react";
import type { BackgroundCommandSummary, SubagentResourceSummary } from "@thinkrail/contracts";
import { useT } from "@thinkrail/locales/react";
import { useState } from "react";
import {
	actionKey,
	type Resource,
	type ResourceActions,
	ResourceRow,
	type ResourceTarget,
	resourceId,
	resourceTarget,
	sortLive,
	sortSettled,
	toResources,
} from "./resourceRow";

const EXPANDED_ROW_LIMIT = 4;

export function ResourcesDock({
	commands,
	subagents,
	freshCommands = [],
	freshSubagents = [],
	now,
	authoritative,
	actions,
	onInspect,
	onStopCommand,
	onStopSubagent,
	onDismiss,
}: {
	commands: BackgroundCommandSummary[];
	subagents: SubagentResourceSummary[];
	freshCommands?: readonly BackgroundCommandSummary[];
	freshSubagents?: readonly SubagentResourceSummary[];
	now: number;
	authoritative: boolean;
	actions: ResourceActions;
	onInspect: (resourceId: string) => void;
	onStopCommand: (commandId: string) => void;
	onStopSubagent: (childSessionId: string) => void;
	onDismiss?: (target: ResourceTarget) => void;
}) {
	const t = useT();
	const stop = (resource: Resource) =>
		resource.kind === "command"
			? onStopCommand(resource.summary.id)
			: onStopSubagent(resource.summary.childSessionId);
	const [collapsedChoice, setCollapsedChoice] = useState<boolean | null>(null);
	const rows = sortLive(toResources(commands, subagents));
	const fresh = sortSettled(toResources(freshCommands, freshSubagents));
	if (rows.length === 0 && fresh.length === 0) return null;
	const collapsed = collapsedChoice ?? rows.length + fresh.length > EXPANDED_ROW_LIMIT;
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
							onSelect={() => onInspect(resourceId(resource))}
							onStop={() => stop(resource)}
						/>
					))}
					{fresh.map((resource) => (
						<ResourceRow
							key={actionKey(resource)}
							resource={resource}
							now={now}
							authoritative={authoritative}
							action={actions[actionKey(resource)]}
							fresh
							onSelect={() => onInspect(resourceId(resource))}
							onStop={() => stop(resource)}
							onDismiss={onDismiss ? () => onDismiss(resourceTarget(resource)) : undefined}
						/>
					))}
				</ul>
			)}
			<button
				type="button"
				data-testid="resources-dock-toggle"
				aria-expanded={!collapsed}
				onClick={() => setCollapsedChoice(!collapsed)}
				className="flex min-h-28 w-full items-center gap-8 rounded-sm px-8 text-text-muted tr-text-metadata outline-none hover:bg-control-bg-hovered hover:text-text-default focus-visible:ring-2 focus-visible:ring-primary"
			>
				{!authoritative ? (
					<RiLoader4Line className="size-12 shrink-0 animate-spin motion-reduce:animate-none" />
				) : rows.length > 0 ? (
					<span
						aria-hidden
						className="size-6 shrink-0 rounded-full bg-primary motion-safe:animate-working"
					/>
				) : null}
				{rows.length > 0 || !authoritative ? (
					<span>
						{authoritative
							? t("resources.dock.active", { count: rows.length })
							: t("resources.dock.activeReconnecting", { count: rows.length })}
					</span>
				) : null}
				{fresh.length > 0 ? (
					<span data-testid="resources-dock-fresh" className="text-primary">
						{t("resources.dock.fresh", { count: fresh.length })}
					</span>
				) : null}
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
				<span className="text-text-subtle">
					{collapsed ? t("resources.dock.show") : t("resources.dock.hide")}
				</span>
				<Chevron className="size-14 shrink-0" />
			</button>
		</div>
	);
}
