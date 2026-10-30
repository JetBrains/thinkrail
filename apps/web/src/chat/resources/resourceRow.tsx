import {
	RiCheckboxBlankCircleFill,
	RiCheckboxCircleFill,
	RiCloseCircleFill,
	RiIndeterminateCircleLine,
	RiLoader4Line,
	RiRobot2Line,
	RiShutDownLine,
	RiStopFill,
	RiTerminalBoxLine,
	RiTimeLine,
} from "@remixicon/react";
import {
	type BackgroundCommandStatus,
	type BackgroundCommandSummary,
	compareResourceHistory,
	type DelegationRunStatus,
	type ResourceRecord,
	resourceHistoryCursor,
	resourceRecordId,
	type SubagentResourceSummary,
} from "@thinkrail/contracts";
import { type Translator, useT } from "@thinkrail/locales/react";
import { cn } from "@thinkrail/ui/utils";
import type { KeyboardEvent, ReactNode } from "react";

export type ResourceAction = { pending: boolean; error: string | null };
export type ResourceActions = Record<string, ResourceAction>;

export type Resource = ResourceRecord;

export type ResourceState =
	| "working"
	| "queued"
	| "stopping"
	| "done"
	| "failed"
	| "stopped"
	| "interrupted";

export type ResourceTarget =
	| { kind: "command"; id: string }
	| { kind: "subagent"; childSessionId: string };

export function resourceTarget(resource: Resource): ResourceTarget {
	return resource.kind === "command"
		? { kind: "command", id: resource.summary.id }
		: { kind: "subagent", childSessionId: resource.summary.childSessionId };
}

export const resourceId: (resource: Resource) => string = resourceRecordId;

export function actionKey(resource: Resource): string {
	return `${resource.kind}:${resourceId(resource)}`;
}

export function commandState(
	status: BackgroundCommandStatus,
	exitCode: number | null | undefined,
): ResourceState {
	if (status === "running") return "working";
	if (status === "stopping") return "stopping";
	if (status === "stopped") return "stopped";
	if (status === "error") return "failed";
	return exitCode === 0 ? "done" : "failed";
}

export function subagentState(status: DelegationRunStatus): ResourceState {
	switch (status) {
		case "queued":
			return "queued";
		case "running":
			return "working";
		case "completed":
			return "done";
		case "error":
			return "failed";
		case "aborted":
			return "stopped";
	}
}

export function resourceState(resource: Resource): ResourceState {
	if (resource.summary.interrupted) return "interrupted";
	return resource.kind === "command"
		? commandState(resource.summary.status, resource.summary.exitCode)
		: subagentState(resource.summary.status);
}

export function isLiveState(state: ResourceState): boolean {
	return state === "working" || state === "queued" || state === "stopping";
}

export function startedAt(resource: Resource): number {
	return resource.kind === "command"
		? resource.summary.startedAt
		: Date.parse(resource.summary.createdAt);
}

export function toResources(
	commands: readonly BackgroundCommandSummary[],
	subagents: readonly SubagentResourceSummary[],
): Resource[] {
	return [
		...commands.map((summary): Resource => ({ kind: "command", summary })),
		...subagents.map((summary): Resource => ({ kind: "subagent", summary })),
	];
}

/** Oldest start first, regardless of live state, so a row never jumps when it starts or stops. */
export function sortLive(resources: readonly Resource[]): Resource[] {
	return resources.slice().sort((a, b) => startedAt(a) - startedAt(b));
}

export function sortSettled(resources: readonly Resource[]): Resource[] {
	return resources
		.slice()
		.sort((a, b) => compareResourceHistory(resourceHistoryCursor(a), resourceHistoryCursor(b)));
}

export function newestResourceId(
	commands: readonly BackgroundCommandSummary[],
	subagents: readonly SubagentResourceSummary[],
): string | null {
	const newest = sortSettled(toResources(commands, subagents))[0];
	return newest ? resourceId(newest) : null;
}

export function resourceName(t: Translator, resource: Resource): string {
	return resource.kind === "command"
		? resource.summary.name
		: (resource.summary.roleName ?? t("resources.subagent.defaultName"));
}

export function resourceActivity(resource: Resource): string {
	return resource.kind === "command" ? resource.summary.command : resource.summary.task;
}

export function stateLabel(t: Translator, state: ResourceState, kind: Resource["kind"]): string {
	switch (state) {
		case "working":
			return kind === "command" ? t("resources.state.running") : t("resources.state.working");
		case "queued":
			return t("resources.state.queued");
		case "stopping":
			return t("resources.state.stopping");
		case "done":
			return t("resources.state.done");
		case "failed":
			return t("resources.state.failed");
		case "stopped":
			return t("resources.state.stopped");
		case "interrupted":
			return t("resources.state.interrupted");
	}
}

export function formatElapsed(t: Translator, ms: number): string {
	const minutes = Math.max(0, Math.floor(ms / 60_000));
	if (minutes < 1) return t("resources.elapsed.underMinute");
	if (minutes < 60) return t("resources.elapsed.minutes", { minutes });
	const hours = Math.floor(minutes / 60);
	const rest = minutes % 60;
	return rest === 0
		? t("resources.elapsed.hours", { hours })
		: t("resources.elapsed.hoursMinutes", { hours, minutes: rest });
}

function runMs(resource: Resource, now: number): number | null {
	const state = resourceState(resource);
	if (state === "queued") return null;
	if (isLiveState(state)) {
		const start = startedAt(resource);
		return Number.isFinite(start) ? now - start : null;
	}
	if (resource.kind === "subagent") return resource.summary.durationMs ?? null;
	const { startedAt: start, finishedAt: end } = resource.summary;
	return end === undefined ? null : end - start;
}

export function elapsedLabel(t: Translator, resource: Resource, now: number): string | null {
	const ms = runMs(resource, now);
	return ms === null ? null : formatElapsed(t, ms);
}

const STATE_TEXT: Record<ResourceState, string> = {
	working: "text-primary",
	queued: "text-text-subtle",
	stopping: "text-text-subtle",
	done: "text-feedback-success",
	failed: "text-feedback-error",
	stopped: "text-text-subtle",
	interrupted: "text-text-subtle",
};

const STATE_DOT: Record<ResourceState, string> = {
	working: "bg-primary",
	queued: "bg-text-subtle",
	stopping: "bg-text-subtle",
	done: "bg-feedback-success",
	failed: "bg-feedback-error",
	stopped: "bg-text-subtle",
	interrupted: "bg-text-subtle",
};

export function StateIcon({ state }: { state: ResourceState }) {
	const className = cn("size-12 shrink-0", STATE_TEXT[state]);
	switch (state) {
		case "done":
			return <RiCheckboxCircleFill className={className} />;
		case "failed":
			return <RiCloseCircleFill className={className} />;
		case "stopped":
			return <RiIndeterminateCircleLine className={className} />;
		case "interrupted":
			return <RiShutDownLine className={className} />;
		case "queued":
			return <RiTimeLine className={className} />;
		case "stopping":
			return <RiLoader4Line className={cn(className, "animate-spin motion-reduce:animate-none")} />;
		case "working":
			return (
				<RiCheckboxBlankCircleFill
					className={cn(className, "size-8 motion-safe:animate-working")}
				/>
			);
	}
}

export function StateText({ state, kind }: { state: ResourceState; kind: Resource["kind"] }) {
	const t = useT();
	return (
		<span className={cn("inline-flex items-center gap-4 whitespace-nowrap", STATE_TEXT[state])}>
			<StateIcon state={state} />
			{stateLabel(t, state, kind)}
		</span>
	);
}

export function ExitBadge({ exitCode }: { exitCode: number }) {
	const t = useT();
	return (
		<span
			className={cn(
				"shrink-0 rounded-xs border px-4 tr-code-text-small",
				exitCode === 0
					? "border-feedback-success-muted text-feedback-success"
					: "border-feedback-error-muted text-feedback-error",
			)}
		>
			{t("resources.row.exit", { code: exitCode })}
		</span>
	);
}

export function KindGlyph({
	kind,
	state,
	className,
	dotRingClassName = "ring-container-elevated-bg",
}: {
	kind: Resource["kind"];
	state: ResourceState;
	className?: string;
	dotRingClassName?: string;
}) {
	const Icon = kind === "command" ? RiTerminalBoxLine : RiRobot2Line;
	return (
		<span
			className={cn("relative inline-flex size-16 shrink-0 items-center justify-center", className)}
		>
			<Icon className="size-14 text-text-muted" />
			<span
				aria-hidden
				className={cn(
					"-right-2 -bottom-2 absolute size-6 rounded-full ring-2",
					dotRingClassName,
					STATE_DOT[state],
				)}
			/>
		</span>
	);
}

function RowActionButton({
	label,
	testId,
	disabled,
	danger,
	onClick,
	children,
}: {
	label: string;
	testId: string;
	disabled?: boolean;
	danger?: boolean;
	onClick: () => void;
	children: ReactNode;
}) {
	return (
		<button
			type="button"
			data-testid={testId}
			aria-label={label}
			title={label}
			disabled={disabled}
			onClick={(event) => {
				event.stopPropagation();
				onClick();
			}}
			className={cn(
				"inline-flex size-24 shrink-0 items-center justify-center rounded-sm text-text-muted outline-none hover:bg-control-bg hover:text-text-default focus-visible:ring-2 focus-visible:ring-primary disabled:text-control-disabled-text",
				danger && "hover:bg-feedback-error-subtle hover:text-feedback-error",
			)}
		>
			{children}
		</button>
	);
}

export interface ResourceRowProps {
	resource: Resource;
	now: number;
	authoritative: boolean;
	action: ResourceAction | undefined;
	stopAllPending?: boolean;
	selected?: boolean;
	/**
	 * `option`: a selectable row inside the inspector's listbox — a presentational wrapper holds the
	 * option and its Stop control as siblings, so no control nests inside the option.
	 * `listitem`: a dock row whose name and activity are one Inspect button.
	 */
	role?: "option" | "listitem";
	fresh?: boolean;
	onSelect: () => void;
	onStop: () => void;
}

const ACCESSIBLE_ACTIVITY_LIMIT = 80;

function accessibleName(
	t: Translator,
	name: string,
	activity: string,
	state: string,
	fresh: boolean,
): string {
	const trimmed =
		activity.length > ACCESSIBLE_ACTIVITY_LIMIT
			? `${activity.slice(0, ACCESSIBLE_ACTIVITY_LIMIT - 1)}…`
			: activity;
	return t(fresh ? "resources.row.accessibleNameNew" : "resources.row.accessibleName", {
		name,
		activity: trimmed,
		state,
	});
}

export function ResourceRow({
	resource,
	now,
	authoritative,
	action,
	stopAllPending = false,
	selected = false,
	role = "listitem",
	fresh = false,
	onSelect,
	onStop,
}: ResourceRowProps) {
	const t = useT();
	const state = resourceState(resource);
	const live = isLiveState(state);
	const id = resourceId(resource);
	const name = resourceName(t, resource);
	const activity = resourceActivity(resource);
	const label = stateLabel(t, state, resource.kind);
	const elapsed = elapsedLabel(t, resource, now);
	const exitCode = resource.kind === "command" ? resource.summary.exitCode : undefined;
	const stopDisabled =
		!authoritative ||
		state === "stopping" ||
		!!action?.pending ||
		(resource.kind === "subagent" && stopAllPending);
	const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		if (event.target !== event.currentTarget) return;
		if (event.key === "Enter" || event.key === " ") {
			event.preventDefault();
			onSelect();
		}
	};
	const nameClass = live
		? "tr-title-compact text-text-default"
		: "text-text-muted tr-text-metadata";
	const activityClass = cn(
		"min-w-0 truncate text-text-muted tr-text-metadata",
		resource.kind === "command" && "tr-code-text-small",
	);
	const meta = (
		<span className="flex shrink-0 items-center gap-8 text-text-subtle tr-text-metadata tabular-nums group-hover:hidden group-focus-within:hidden">
			<StateText state={state} kind={resource.kind} />
			{elapsed ? <span>{elapsed}</span> : null}
			{exitCode !== undefined && exitCode !== null ? <ExitBadge exitCode={exitCode} /> : null}
		</span>
	);
	const actions = (
		<span className="hidden shrink-0 items-center gap-2 group-hover:inline-flex group-focus-within:inline-flex">
			{live ? (
				<RowActionButton
					label={action?.pending ? t("resources.action.stopping") : t("resources.action.stop")}
					testId="resource-stop"
					disabled={stopDisabled}
					danger
					onClick={onStop}
				>
					<RiStopFill className="size-14" />
				</RowActionButton>
			) : null}
		</span>
	);
	const failure = action?.error ? (
		<span role="alert" className="break-words text-feedback-error tr-text-metadata">
			{action.error}
		</span>
	) : null;
	const dataAttributes = {
		"data-testid": resource.kind === "command" ? "resource-command" : "resource-subagent",
		"data-resource-id": id,
		"data-status": resource.summary.status,
		"data-state": state,
		"data-fresh": fresh || undefined,
	};
	const rowClass =
		"group grid min-h-32 min-w-0 items-center gap-8 rounded-sm px-8 py-4 hover:bg-control-bg-hovered";

	if (role === "option") {
		return (
			<div
				role="none"
				{...dataAttributes}
				data-selected={selected || undefined}
				className={cn(
					rowClass,
					"grid-cols-[minmax(0,1fr)_auto]",
					selected ? "bg-control-bg-selected" : fresh && "bg-primary-subtle",
				)}
			>
				<div
					role="option"
					aria-selected={selected}
					aria-label={accessibleName(t, name, activity, label, fresh)}
					tabIndex={0}
					onClick={onSelect}
					onKeyDown={onKeyDown}
					className="grid min-w-0 cursor-default grid-cols-[auto_minmax(0,1fr)] items-center gap-8 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
				>
					<KindGlyph kind={resource.kind} state={state} />
					<span className="flex min-w-0 flex-col">
						<span className="flex min-w-0 items-baseline gap-8">
							<span className={cn("min-w-0 flex-1 truncate", nameClass)} title={name}>
								{name}
							</span>
							{meta}
						</span>
						<span className="flex min-w-0 items-baseline gap-4">
							{fresh ? (
								<span className="shrink-0 rounded-full bg-primary-subtle px-4 tr-text-label-pill text-primary">
									{t("resources.row.new")}
								</span>
							) : null}
							<span className={activityClass} title={activity}>
								{activity}
							</span>
						</span>
						{failure}
					</span>
				</div>
				{actions}
			</div>
		);
	}
	return (
		<li {...dataAttributes} className={cn(rowClass, "grid-cols-[auto_minmax(0,1fr)_auto]")}>
			<KindGlyph kind={resource.kind} state={state} />
			<span className="flex min-w-0 flex-col">
				<button
					type="button"
					data-testid="resource-inspect"
					title={t("resources.row.inspect", { name })}
					onClick={onSelect}
					className="flex min-w-0 items-baseline gap-8 rounded-xs text-left outline-none focus-visible:ring-2 focus-visible:ring-primary"
				>
					<span className={cn("min-w-0 max-w-[60%] shrink-0 truncate", nameClass)}>{name}</span>
					<span className={cn(activityClass, "flex-1")}>{activity}</span>
				</button>
				{failure}
			</span>
			<span className="flex shrink-0 items-center gap-8">
				{meta}
				{actions}
			</span>
		</li>
	);
}
