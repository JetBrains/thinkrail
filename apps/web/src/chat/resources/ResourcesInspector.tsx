import {
	RiAlertLine,
	RiCloseLine,
	RiErrorWarningLine,
	RiInformationLine,
	RiLoader4Line,
	RiStopFill,
} from "@remixicon/react";
import type {
	BackgroundCommandSummary,
	McpServerResourceSummary,
	SubagentResourceSummary,
} from "@thinkrail/contracts";
import { type Translator, useT } from "@thinkrail/locales/react";
import { Button, IconButton } from "@thinkrail/ui/button";
import { Dialog, DialogPanel, DialogTitle } from "@thinkrail/ui/dialog";
import { cn } from "@thinkrail/ui/utils";
import { type KeyboardEvent, type ReactNode, useEffect, useRef } from "react";
import { McpServerSection } from "./mcpRow";
import {
	actionKey,
	ExitBadge,
	elapsedLabel,
	isLiveState,
	KindGlyph,
	type Resource,
	type ResourceActions,
	ResourceRow,
	resourceActivity,
	resourceId,
	resourceName,
	resourceState,
	StateText,
	sortLive,
	sortSettled,
	toResources,
} from "./resourceRow";

export interface ResourcesInspectorProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onCloseAutoFocus?: (event: Event) => void;
	commands: BackgroundCommandSummary[];
	subagents: SubagentResourceSummary[];
	finishedCommands: BackgroundCommandSummary[];
	finishedSubagents: SubagentResourceSummary[];
	now: number;
	authoritative: boolean;
	loading: boolean;
	stale: boolean;
	error: string | null;
	actions: ResourceActions;
	selectedId: string | null;
	onSelect: (resourceId: string) => void;
	onRetry: () => void;
	onStopCommand: (commandId: string) => void;
	onStopSubagent: (childSessionId: string) => void;
	onStopAll: () => void;
	/** The selected row's body: bounded command output or the read-only subagent transcript. */
	detail: ReactNode;
	mcpServers?: McpServerResourceSummary[] | null;
	onMcpSetEnabled?: (name: string, enabled: boolean) => void;
	onMcpReconnect?: (name: string) => void;
	onOpenMcpSettings?: () => void;
}

const ESCAPE_KEY = "Esc";

function formatAgo(t: Translator, ms: number): string {
	const minutes = Math.floor(ms / 60_000);
	if (minutes < 1) return t("resources.ago.justNow");
	if (minutes < 60) return t("resources.ago.minutes", { minutes });
	return t("resources.ago.hours", { hours: Math.floor(minutes / 60) });
}

function DetailHeader({
	resource,
	now,
	authoritative,
	actions,
	onStop,
}: {
	resource: Resource;
	now: number;
	authoritative: boolean;
	actions: ResourceActions;
	onStop: () => void;
}) {
	const t = useT();
	const state = resourceState(resource);
	const live = isLiveState(state);
	const action = actions[actionKey(resource)];
	const started =
		resource.kind === "command"
			? resource.summary.startedAt
			: Date.parse(resource.summary.createdAt);
	const elapsed = elapsedLabel(t, resource, now);
	const exitCode = resource.kind === "command" ? resource.summary.exitCode : undefined;
	const reason =
		resource.kind === "command" ? resource.summary.errorMessage : resource.summary.abortReason;
	return (
		<div className="flex shrink-0 flex-col gap-8 border-border-muted border-b p-12">
			<div className="flex min-w-0 items-center gap-8">
				<KindGlyph kind={resource.kind} state={state} />
				<span className="min-w-0 truncate tr-title-dialog" title={resourceName(t, resource)}>
					{resourceName(t, resource)}
				</span>
				<StateText state={state} kind={resource.kind} />
				<span className="flex-1" />
				{live ? (
					<Button
						variant="outline"
						size="m"
						iconLeft={RiStopFill}
						data-testid="resource-detail-stop"
						disabled={
							!authoritative ||
							state === "stopping" ||
							!!action?.pending ||
							(resource.kind === "subagent" && !!actions.all?.pending)
						}
						onClick={onStop}
						className="text-feedback-error"
					>
						{action?.pending ? t("resources.action.stopping") : t("resources.action.stop")}
					</Button>
				) : null}
			</div>
			<dl className="flex flex-wrap gap-x-16 gap-y-4 text-text-muted tr-text-metadata">
				{Number.isFinite(started) ? (
					<div className="flex gap-4">
						<dt className="text-text-default">
							{resource.kind === "command"
								? t("resources.detail.started")
								: t("resources.detail.created")}
						</dt>
						<dd>{formatAgo(t, now - started)}</dd>
					</div>
				) : null}
				{elapsed ? (
					<div className="flex gap-4">
						<dt className="text-text-default">
							{live ? t("resources.detail.elapsed") : t("resources.detail.duration")}
						</dt>
						<dd>{elapsed}</dd>
					</div>
				) : null}
				{exitCode !== undefined && exitCode !== null ? (
					<div className="flex items-center gap-4">
						<dt className="text-text-default">{t("resources.detail.exit")}</dt>
						<dd>
							<ExitBadge exitCode={exitCode} />
						</dd>
					</div>
				) : null}
				<div className="flex min-w-0 basis-full gap-4">
					<dt className="shrink-0 text-text-default">
						{resource.kind === "command"
							? t("resources.detail.command")
							: t("resources.detail.task")}
					</dt>
					<dd
						className={cn(
							"min-w-0 break-words",
							resource.kind === "command" && "tr-code-text-small",
						)}
					>
						{resourceActivity(resource)}
					</dd>
				</div>
				{reason ? (
					<div className="flex min-w-0 basis-full gap-4 text-feedback-error">
						<dt className="shrink-0">{t("resources.detail.reason")}</dt>
						<dd className="min-w-0 break-words">{reason}</dd>
					</div>
				) : null}
			</dl>
			{action?.error ? (
				<p role="alert" className="break-words text-feedback-error tr-text-metadata">
					{action.error}
				</p>
			) : null}
		</div>
	);
}

export function ResourcesInspector(props: ResourcesInspectorProps) {
	const t = useT();
	const live = sortLive(toResources(props.commands, props.subagents));
	const settled = sortSettled(toResources(props.finishedCommands, props.finishedSubagents));
	const all = [...live, ...settled];
	const selected = all.find((resource) => resourceId(resource) === props.selectedId) ?? all[0];
	const listRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!props.open || !selected || props.selectedId === resourceId(selected)) return;
		props.onSelect(resourceId(selected));
	});

	const stopFor = (resource: Resource) =>
		resource.kind === "command"
			? props.onStopCommand(resource.summary.id)
			: props.onStopSubagent(resource.summary.childSessionId);

	const onListKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
		if (!selected) return;
		const index = all.findIndex((resource) => resourceId(resource) === resourceId(selected));
		const next = all[event.key === "ArrowDown" ? index + 1 : index - 1];
		if (!next) return;
		event.preventDefault();
		const nextId = resourceId(next);
		props.onSelect(nextId);
		listRef.current
			?.querySelector<HTMLElement>(`[data-resource-id="${CSS.escape(nextId)}"] [role="option"]`)
			?.focus();
	};

	const section = (title: string, rows: Resource[], testId: string, empty: string) => (
		<section data-testid={testId} aria-label={title} className="flex flex-col gap-2">
			<div className="flex items-baseline gap-4 px-8 pt-8 pb-2 text-text-subtle">
				<h3 className="tr-text-eyebrow">{title}</h3>
				<span className="tr-text-metadata">· {rows.length}</span>
			</div>
			{rows.length === 0 ? (
				<p className="px-8 py-4 text-text-subtle tr-text-metadata">{empty}</p>
			) : (
				rows.map((resource) => (
					<ResourceRow
						key={actionKey(resource)}
						resource={resource}
						now={props.now}
						authoritative={props.authoritative}
						action={props.actions[actionKey(resource)]}
						stopAllPending={!!props.actions.all?.pending}
						role="option"
						selected={!!selected && resourceId(resource) === resourceId(selected)}
						onSelect={() => props.onSelect(resourceId(resource))}
						onStop={() => stopFor(resource)}
					/>
				))
			)}
		</section>
	);

	const summary = !props.authoritative ? (
		<span className="inline-flex items-center gap-4 whitespace-nowrap rounded-full border border-border-muted px-8 text-text-muted tr-text-metadata">
			<RiLoader4Line className="size-12 animate-spin motion-reduce:animate-none" />
			{t("resources.inspector.reconnecting")}
		</span>
	) : live.length > 0 ? (
		<span className="inline-flex items-center gap-4 whitespace-nowrap rounded-full border border-primary-muted bg-primary-subtle px-8 text-primary tr-text-metadata">
			<span aria-hidden className="size-6 rounded-full bg-primary motion-safe:animate-working" />
			{t("resources.inspector.active", { count: live.length })}
		</span>
	) : (
		<span className="whitespace-nowrap rounded-full border border-border-muted px-8 text-text-muted tr-text-metadata">
			{t("resources.inspector.idle")}
		</span>
	);

	return (
		<Dialog open={props.open} onOpenChange={props.onOpenChange} modal={false}>
			<DialogPanel
				data-testid="resources-inspector"
				aria-describedby={undefined}
				onInteractOutside={(event) => event.preventDefault()}
				onOpenAutoFocus={(event) => {
					event.preventDefault();
					const target =
						listRef.current?.querySelector<HTMLElement>('[role="option"][aria-selected="true"]') ??
						listRef.current;
					target?.focus();
				}}
				{...(props.onCloseAutoFocus ? { onCloseAutoFocus: props.onCloseAutoFocus } : {})}
				className="absolute inset-0 z-20 grid grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,2fr)_minmax(0,3fr)] border-t @[640px]:grid-cols-[272px_minmax(0,1fr)] @[640px]:grid-rows-1"
			>
				<div
					ref={listRef}
					role="listbox"
					aria-label={t("resources.inspector.title")}
					tabIndex={-1}
					onKeyDown={onListKeyDown}
					className="flex min-h-0 min-w-0 flex-col overflow-y-auto overflow-x-hidden border-border-muted border-b p-8 @[640px]:border-r @[640px]:border-b-0"
				>
					<div className="flex items-center gap-8 px-8 py-4">
						<DialogTitle className="flex items-center gap-8">
							{t("resources.inspector.title")} {summary}
						</DialogTitle>
						<span className="flex-1" />
						{props.subagents.length > 0 ? (
							<IconButton
								variant="ghost"
								size="m"
								icon={RiStopFill}
								data-testid="resources-stop-all"
								wrapTrigger
								label={
									props.actions.all?.pending
										? t("resources.inspector.stoppingAll")
										: t("resources.inspector.stopAll")
								}
								disabled={
									!props.authoritative ||
									!!props.actions.all?.pending ||
									props.subagents.some(
										(child) => props.actions[`subagent:${child.childSessionId}`]?.pending,
									)
								}
								onClick={props.onStopAll}
								className="text-feedback-error hover:text-feedback-error"
							/>
						) : null}
						<IconButton
							icon={RiCloseLine}
							label={t("resources.inspector.close")}
							data-testid="resources-inspector-close"
							onClick={() => props.onOpenChange(false)}
							className="shrink-0"
						/>
					</div>
					{props.actions.all?.error ? (
						<p role="alert" className="px-8 text-feedback-error tr-text-metadata">
							{props.actions.all.error}
						</p>
					) : null}
					{props.loading ? (
						<p className="px-8 text-text-muted tr-text-metadata">
							{t("resources.inspector.loading")}
						</p>
					) : null}
					{props.stale ? (
						<p className="mx-8 flex items-center gap-8 rounded-sm border border-feedback-warning-muted bg-container-elevated-bg px-8 py-4 text-text-default tr-text-metadata">
							<RiAlertLine className="size-14 shrink-0 text-feedback-warning" aria-hidden />
							{t("resources.inspector.stale")}
						</p>
					) : null}
					{props.error ? (
						<div
							role="alert"
							className="mx-8 flex flex-col gap-8 rounded-sm border border-feedback-error-muted bg-container-elevated-bg px-8 py-4 text-text-default tr-text-metadata"
						>
							<div className="flex items-start gap-8">
								<RiErrorWarningLine
									className="mt-2 size-14 shrink-0 text-feedback-error"
									aria-hidden
								/>
								<span className="min-w-0 flex-1 break-words">{props.error}</span>
							</div>
							<div className="flex justify-end">
								<Button
									variant="outline"
									size="m"
									data-testid="resources-retry"
									onClick={props.onRetry}
								>
									{t("common.retry")}
								</Button>
							</div>
						</div>
					) : null}
					{section(
						t("resources.inspector.activeSection"),
						live,
						"resources-active",
						t("resources.inspector.activeEmpty"),
					)}
					{section(
						t("resources.inspector.finishedSection"),
						settled,
						"resources-finished",
						t("resources.inspector.finishedEmpty"),
					)}
					{props.mcpServers ? (
						<McpServerSection
							servers={props.mcpServers}
							authoritative={props.authoritative}
							actions={props.actions}
							onSetEnabled={(name, enabled) => props.onMcpSetEnabled?.(name, enabled)}
							onReconnect={(name) => props.onMcpReconnect?.(name)}
							onOpenSettings={() => props.onOpenMcpSettings?.()}
						/>
					) : null}
					<p className="mt-auto flex items-center gap-8 px-8 pt-8 text-text-subtle tr-text-metadata">
						<RiInformationLine className="size-14 shrink-0" />
						{t("resources.inspector.retention")}
					</p>
				</div>
				<div data-testid="resources-inspector-detail" className="flex min-h-0 flex-col">
					{selected ? (
						<>
							<DetailHeader
								resource={selected}
								now={props.now}
								authoritative={props.authoritative}
								actions={props.actions}
								onStop={() => stopFor(selected)}
							/>
							<div className="flex min-h-0 flex-1 flex-col gap-8 p-12">{props.detail}</div>
						</>
					) : (
						<p className="flex-1 p-12 text-text-subtle tr-text-metadata">
							{t("resources.inspector.nothingSelected")}
						</p>
					)}
					<div className="flex shrink-0 items-center gap-8 border-border-muted border-t px-12 py-4 text-text-subtle tr-text-metadata">
						<span className="flex-1">
							{selected?.kind === "subagent"
								? t("resources.inspector.subagentFooter")
								: t("resources.inspector.commandFooter")}
						</span>
						<kbd className="rounded-xs border border-border-default px-4">↑</kbd>
						<kbd className="rounded-xs border border-border-default px-4">↓</kbd>
						<span>{t("resources.inspector.switchHint")}</span>
						<kbd className="rounded-xs border border-border-default px-4">{ESCAPE_KEY}</kbd>
						<span>{t("resources.inspector.closeHint")}</span>
					</div>
				</div>
			</DialogPanel>
		</Dialog>
	);
}
