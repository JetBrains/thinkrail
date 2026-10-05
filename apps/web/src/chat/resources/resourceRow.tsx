import {
	RiCheckboxBlankCircleFill,
	RiCheckboxCircleFill,
	RiCloseCircleFill,
	RiIndeterminateCircleLine,
	RiLoader4Line,
	RiRobot2Line,
	RiStopFill,
	RiTerminalBoxLine,
	RiTimeLine,
} from "@remixicon/react";
import type { BackgroundCommandSummary, SubagentResourceSummary } from "@thinkrail/contracts";
import type { KeyboardEvent, MouseEvent, ReactNode } from "react";
import { cn } from "@/lib";

export type ResourceAction = { pending: boolean; error: string | null };
export type ResourceActions = Record<string, ResourceAction>;

export type Resource =
	| { kind: "command"; summary: BackgroundCommandSummary }
	| { kind: "subagent"; summary: SubagentResourceSummary };

export type ResourceState = "working" | "queued" | "stopping" | "done" | "failed" | "stopped";

export function resourceId(resource: Resource): string {
	return resource.kind === "command" ? resource.summary.id : resource.summary.childSessionId;
}

export function actionKey(resource: Resource): string {
	return `${resource.kind}:${resourceId(resource)}`;
}

export function resourceState(resource: Resource): ResourceState {
	if (resource.kind === "command") {
		const { status, exitCode } = resource.summary;
		if (status === "running") return "working";
		if (status === "stopping") return "stopping";
		if (status === "stopped") return "stopped";
		if (status === "error") return "failed";
		return exitCode === 0 ? "done" : "failed";
	}
	switch (resource.summary.status) {
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

export function isLiveState(state: ResourceState): boolean {
	return state === "working" || state === "queued" || state === "stopping";
}

export function startedAt(resource: Resource): number {
	return resource.kind === "command"
		? resource.summary.startedAt
		: Date.parse(resource.summary.createdAt);
}

export function finishedAt(resource: Resource): number | undefined {
	return resource.kind === "command" ? resource.summary.finishedAt : undefined;
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
		.sort((a, b) => (finishedAt(b) ?? startedAt(b)) - (finishedAt(a) ?? startedAt(a)));
}

export function resourceName(resource: Resource): string {
	return resource.kind === "command"
		? resource.summary.name
		: (resource.summary.roleName ?? "Subagent");
}

export function resourceActivity(resource: Resource): string {
	return resource.kind === "command" ? resource.summary.command : resource.summary.task;
}

export function stateLabel(state: ResourceState, kind: Resource["kind"]): string {
	switch (state) {
		case "working":
			return kind === "command" ? "Running" : "Working";
		case "queued":
			return "Queued";
		case "stopping":
			return "Stopping…";
		case "done":
			return "Done";
		case "failed":
			return "Failed";
		case "stopped":
			return "Stopped";
	}
}

export function formatElapsed(ms: number): string {
	const minutes = Math.max(0, Math.floor(ms / 60_000));
	if (minutes < 1) return "<1 min";
	if (minutes < 60) return `${minutes} min`;
	const hours = Math.floor(minutes / 60);
	const rest = minutes % 60;
	return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

export function elapsedLabel(resource: Resource, now: number): string | null {
	const state = resourceState(resource);
	if (state === "queued") return null;
	const start = startedAt(resource);
	if (!Number.isFinite(start)) return null;
	const end = isLiveState(state) ? now : (finishedAt(resource) ?? null);
	return end === null ? null : formatElapsed(end - start);
}

const STATE_TEXT: Record<ResourceState, string> = {
	working: "text-primary",
	queued: "text-text-subtle",
	stopping: "text-text-subtle",
	done: "text-feedback-success",
	failed: "text-feedback-error",
	stopped: "text-text-subtle",
};

const STATE_DOT: Record<ResourceState, string> = {
	working: "bg-primary",
	queued: "bg-text-subtle",
	stopping: "bg-text-subtle",
	done: "bg-feedback-success",
	failed: "bg-feedback-error",
	stopped: "bg-text-subtle",
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
	return (
		<span className={cn("inline-flex items-center gap-4 whitespace-nowrap", STATE_TEXT[state])}>
			<StateIcon state={state} />
			{stateLabel(state, kind)}
		</span>
	);
}

export function ExitBadge({ exitCode }: { exitCode: number }) {
	return (
		<span
			className={cn(
				"shrink-0 rounded-[var(--radius-xs)] border px-4 tr-code-text-small",
				exitCode === 0
					? "border-feedback-success-muted text-feedback-success"
					: "border-feedback-error-muted text-feedback-error",
			)}
		>
			exit {exitCode}
		</span>
	);
}

export function KindGlyph({
	resource,
	state,
	className,
}: {
	resource: Resource;
	state: ResourceState;
	className?: string;
}) {
	const Icon = resource.kind === "command" ? RiTerminalBoxLine : RiRobot2Line;
	return (
		<span
			className={cn("relative inline-flex size-16 shrink-0 items-center justify-center", className)}
		>
			<Icon className="size-14 text-text-muted" />
			<span
				aria-hidden
				className={cn(
					"-right-2 -bottom-2 absolute size-6 rounded-full ring-2 ring-container-elevated-bg",
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
				"inline-flex size-24 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-text-muted outline-none hover:bg-control-bg hover:text-text-default focus-visible:ring-2 focus-visible:ring-primary disabled:text-control-disabled-text",
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
	/** `option`: a selectable row inside the inspector's listbox. `listitem`: a dock row whose name opens the inspector. */
	role?: "option" | "listitem";
	/** Narrow roster rows: name · state · elapsed, no activity text. */
	compact?: boolean;
	onSelect: () => void;
	onStop: () => void;
}

export function ResourceRow({
	resource,
	now,
	authoritative,
	action,
	stopAllPending = false,
	selected = false,
	role = "listitem",
	compact = false,
	onSelect,
	onStop,
}: ResourceRowProps) {
	const state = resourceState(resource);
	const live = isLiveState(state);
	const id = resourceId(resource);
	const name = resourceName(resource);
	const activity = resourceActivity(resource);
	const elapsed = elapsedLabel(resource, now);
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
	const onClick = (event: MouseEvent<HTMLDivElement>) => {
		if (event.target instanceof Element && event.target.closest("button")) return;
		onSelect();
	};
	const selectable = role === "option";
	const shared = {
		"data-testid": resource.kind === "command" ? "resource-command" : "resource-subagent",
		"data-resource-id": id,
		"data-status": resource.summary.status,
		"data-state": state,
		"aria-label": `${name}, ${stateLabel(state, resource.kind)}`,
		className: cn(
			"group grid min-h-32 min-w-0 cursor-default grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-8 rounded-[var(--radius-sm)] px-8 py-4 outline-none hover:bg-control-bg-hovered focus-visible:ring-2 focus-visible:ring-primary",
			selected && "bg-control-bg-selected",
		),
	};
	const body = (
		<>
			<KindGlyph resource={resource} state={state} />
			<span className="flex min-w-0 flex-col">
				{selectable ? (
					<span className="flex min-w-0 items-baseline gap-8">
						<span
							className={cn(
								"min-w-0 truncate",
								compact ? "flex-1" : "max-w-[60%] shrink-0",
								live ? "tr-title-compact text-text-default" : "text-text-muted tr-text-metadata",
							)}
							title={compact ? `${name} — ${activity}` : name}
						>
							{name}
						</span>
						{compact ? null : (
							<span
								className={cn(
									"min-w-0 flex-1 truncate text-text-muted tr-text-metadata",
									resource.kind === "command" && "tr-code-text-small",
								)}
								title={activity}
							>
								{activity}
							</span>
						)}
					</span>
				) : (
					<button
						type="button"
						data-testid="resource-inspect"
						title={`Inspect ${name}`}
						onClick={onSelect}
						className="flex min-w-0 items-baseline gap-8 rounded-[var(--radius-xs)] text-left outline-none focus-visible:ring-2 focus-visible:ring-primary"
					>
						<span
							className={cn(
								"min-w-0 max-w-[60%] shrink-0 truncate",
								live ? "tr-title-compact text-text-default" : "text-text-muted tr-text-metadata",
							)}
						>
							{name}
						</span>
						<span
							className={cn(
								"min-w-0 flex-1 truncate text-text-muted tr-text-metadata",
								resource.kind === "command" && "tr-code-text-small",
							)}
						>
							{activity}
						</span>
					</button>
				)}
				{action?.error ? (
					<span role="alert" className="break-words text-feedback-error tr-text-metadata">
						{action.error}
					</span>
				) : null}
			</span>
			<span className="flex shrink-0 items-center gap-8 text-text-subtle tr-text-metadata tabular-nums">
				<span className="flex items-center gap-8 group-hover:hidden group-focus-within:hidden">
					<StateText state={state} kind={resource.kind} />
					{elapsed ? <span>{elapsed}</span> : null}
					{exitCode !== undefined && exitCode !== null ? <ExitBadge exitCode={exitCode} /> : null}
				</span>
				<span className="hidden items-center gap-2 group-hover:inline-flex group-focus-within:inline-flex">
					{live ? (
						<RowActionButton
							label={action?.pending ? "Stopping…" : "Stop"}
							testId="resource-stop"
							disabled={stopDisabled}
							danger
							onClick={onStop}
						>
							<RiStopFill className="size-14" />
						</RowActionButton>
					) : null}
				</span>
			</span>
		</>
	);
	return selectable ? (
		<div
			role="option"
			aria-selected={selected}
			tabIndex={0}
			onClick={onClick}
			onKeyDown={onKeyDown}
			{...shared}
		>
			{body}
		</div>
	) : (
		<li {...shared}>{body}</li>
	);
}
