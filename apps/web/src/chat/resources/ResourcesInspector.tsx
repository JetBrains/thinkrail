import {
	RiAlertLine,
	RiArrowDownSLine,
	RiArrowRightSLine,
	RiCloseLine,
	RiErrorWarningLine,
	RiInformationLine,
	RiLoader4Line,
	RiStopFill,
} from "@remixicon/react";
import {
	type BackgroundCommandSummary,
	type McpServerResourceSummary,
	RESOURCE_HISTORY_PAGE_LIMIT,
	type ResourceKind,
	type ResourceTally,
	resourceTallyTotal,
	type SessionResourceHistory,
	type SubagentResourceSummary,
	tallyResources,
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
	StateIcon,
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
	history: SessionResourceHistory;
	remaining?: Partial<Record<ResourceKind, number>>;
	newIds?: ReadonlySet<string>;
	expanded: Partial<Record<ResourceKind, boolean>>;
	onExpandedChange: (kind: ResourceKind, expanded: boolean) => void;
	onLoadMore?: (kind: ResourceKind) => void;
	retained?: boolean;
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
	renderSubagentModel?: (summary: SubagentResourceSummary) => ReactNode;
	mcpServers?: McpServerResourceSummary[] | null;
	onMcpSetEnabled?: (name: string, enabled: boolean) => void;
	onMcpReconnect?: (name: string) => void;
	onOpenMcpSettings?: () => void;
}

const ESCAPE_KEY = "Esc";
const FINISHED_ABOVE_FOLD = 5;
const NONE: ReadonlySet<string> = new Set();

function formatAgo(t: Translator, ms: number): string {
	const minutes = Math.floor(ms / 60_000);
	if (minutes < 1) return t("resources.ago.justNow");
	if (minutes < 60) return t("resources.ago.minutes", { minutes });
	return t("resources.ago.hours", { hours: Math.floor(minutes / 60) });
}

function hiddenTally(total: ResourceTally, shown: ResourceTally): ResourceTally {
	return {
		done: Math.max(0, total.done - shown.done),
		failed: Math.max(0, total.failed - shown.failed),
		stopped: Math.max(0, total.stopped - shown.stopped),
		interrupted: Math.max(0, total.interrupted - shown.interrupted),
	};
}

interface Category {
	kind: ResourceKind;
	live: Resource[];
	above: Resource[];
	below: Resource[];
	total: number;
	hidden: number;
	tally: ResourceTally;
	expanded: boolean;
}

function category(
	kind: ResourceKind,
	live: Resource[],
	finished: Resource[],
	historyTally: ResourceTally,
	pinned: ReadonlySet<string>,
	expanded: boolean,
): Category {
	const sorted = sortSettled(finished);
	const above = sorted.filter(
		(resource, index) =>
			index < FINISHED_ABOVE_FOLD || (!expanded && pinned.has(resourceId(resource))),
	);
	const shown = new Set(above.map(resourceId));
	const total = Math.max(resourceTallyTotal(historyTally), sorted.length);
	return {
		kind,
		live: sortLive(live),
		above,
		below: sorted.filter((resource) => !shown.has(resourceId(resource))),
		total,
		hidden: total - above.length,
		tally: hiddenTally(historyTally, tallyResources(above)),
		expanded,
	};
}

function visibleRows(group: Category): Resource[] {
	return [...group.live, ...group.above, ...(group.expanded ? group.below : [])];
}

function DetailHeader({
	resource,
	now,
	authoritative,
	actions,
	onStop,
	renderSubagentModel,
}: {
	resource: Resource;
	now: number;
	authoritative: boolean;
	actions: ResourceActions;
	onStop: () => void;
	renderSubagentModel: ResourcesInspectorProps["renderSubagentModel"];
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
	const model =
		resource.kind === "subagent" && resource.summary.model
			? renderSubagentModel?.(resource.summary)
			: null;
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
						tone="danger"
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
				{model ? (
					<div data-testid="resource-detail-model" className="flex min-w-0 items-center gap-4">
						<dt className="shrink-0 text-text-default">{t("resources.detail.model")}</dt>
						<dd className="flex min-w-0">{model}</dd>
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
				{state === "interrupted" ? (
					<div data-testid="resource-detail-interrupted" className="flex min-w-0 basis-full gap-4">
						<dt className="shrink-0 text-text-default">{t("resources.detail.reason")}</dt>
						<dd className="min-w-0 break-words">{t("resources.detail.interrupted")}</dd>
					</div>
				) : reason ? (
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

function FoldRow({ group, onToggle }: { group: Category; onToggle: () => void }) {
	const t = useT();
	const { done, failed } = group.tally;
	const stopped = group.tally.stopped + group.tally.interrupted;
	const Chevron = group.expanded ? RiArrowDownSLine : RiArrowRightSLine;
	return (
		<button
			type="button"
			data-testid="resources-fold"
			data-kind={group.kind}
			aria-expanded={group.expanded}
			aria-label={t("resources.inspector.foldLabel", {
				count: group.hidden,
				done,
				failed,
				stopped,
			})}
			onClick={onToggle}
			className="flex min-h-28 items-center gap-8 rounded-sm border border-border-muted px-8 text-left text-text-muted tr-text-metadata outline-none hover:bg-control-bg-hovered hover:text-text-default focus-visible:ring-2 focus-visible:ring-primary"
		>
			<Chevron className="size-14 shrink-0" />
			<span className="min-w-0 truncate">
				{t("resources.inspector.foldMore", { count: group.hidden })}
			</span>
			<span aria-hidden className="ml-auto flex shrink-0 items-center gap-8 tabular-nums">
				{done > 0 ? (
					<span className="inline-flex items-center gap-2">
						<StateIcon state="done" />
						{done}
					</span>
				) : null}
				{failed > 0 ? (
					<span className="inline-flex items-center gap-2">
						<StateIcon state="failed" />
						{failed}
					</span>
				) : null}
				{stopped > 0 ? (
					<span className="inline-flex items-center gap-2">
						<StateIcon state="stopped" />
						{stopped}
					</span>
				) : null}
			</span>
		</button>
	);
}

export function ResourcesInspector(props: ResourcesInspectorProps) {
	const t = useT();
	const fresh = props.newIds ?? NONE;
	const pinned = props.selectedId ? new Set([...fresh, props.selectedId]) : fresh;
	const groups = [
		category(
			"command",
			toResources(props.commands, []),
			toResources(props.finishedCommands, []),
			props.history.commands,
			pinned,
			!!props.expanded.command,
		),
		category(
			"subagent",
			toResources([], props.subagents),
			toResources([], props.finishedSubagents),
			props.history.subagents,
			pinned,
			!!props.expanded.subagent,
		),
	];
	const live = groups.flatMap((group) => group.live);
	const all = groups.flatMap(visibleRows);
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

	const row = (resource: Resource) => (
		<ResourceRow
			key={actionKey(resource)}
			resource={resource}
			now={props.now}
			authoritative={props.authoritative}
			action={props.actions[actionKey(resource)]}
			stopAllPending={!!props.actions.all?.pending}
			role="option"
			selected={!!selected && resourceId(resource) === resourceId(selected)}
			fresh={fresh.has(resourceId(resource))}
			onSelect={() => props.onSelect(resourceId(resource))}
			onStop={() => stopFor(resource)}
		/>
	);

	const section = (group: Category) => {
		if (group.live.length === 0 && group.total === 0) return null;
		const title =
			group.kind === "command"
				? t("resources.inspector.commandsSection")
				: t("resources.inspector.subagentsSection");
		const meta = [
			group.live.length > 0 ? t("resources.inspector.active", { count: group.live.length }) : null,
			group.total > 0 ? t("resources.inspector.finished", { count: group.total }) : null,
		]
			.filter((part) => part !== null)
			.join(" · ");
		const left = props.remaining?.[group.kind] ?? 0;
		const paging = props.actions[`history:${group.kind}`];
		return (
			<section
				key={group.kind}
				data-testid={group.kind === "command" ? "resources-commands" : "resources-subagents"}
				aria-label={title}
				className="flex flex-col gap-2"
			>
				<div className="flex items-baseline gap-4 px-8 pt-8 pb-2 text-text-subtle">
					<h3 className="tr-text-eyebrow">{title}</h3>
					<span className="tr-text-metadata">· {meta}</span>
				</div>
				{group.live.map(row)}
				{group.total > 0 ? (
					<div
						data-testid="resources-finished"
						className="flex items-baseline gap-4 px-8 pt-4 text-text-subtle tr-text-metadata"
					>
						<span className="text-text-muted">{t("resources.inspector.finishedSection")}</span>
						<span>· {group.total}</span>
					</div>
				) : null}
				{group.above.map(row)}
				{group.hidden > 0 ? (
					<FoldRow
						group={group}
						onToggle={() => props.onExpandedChange(group.kind, !group.expanded)}
					/>
				) : null}
				{group.expanded ? group.below.map(row) : null}
				{group.expanded && group.hidden > 0 ? (
					<div className="flex items-center gap-8 px-4">
						{left > 0 && props.onLoadMore ? (
							<Button
								variant="ghost"
								size="s"
								data-testid="resources-show-more"
								data-kind={group.kind}
								disabled={!props.authoritative || !!paging?.pending}
								onClick={() => props.onLoadMore?.(group.kind)}
							>
								{paging?.pending
									? t("resources.inspector.loadingMore")
									: t("resources.inspector.showMore", {
											count: Math.min(RESOURCE_HISTORY_PAGE_LIMIT, left),
											left,
										})}
							</Button>
						) : null}
						<span className="flex-1" />
						<Button
							variant="ghost"
							size="s"
							data-testid="resources-collapse"
							data-kind={group.kind}
							onClick={() => props.onExpandedChange(group.kind, false)}
						>
							{t("resources.inspector.collapse")}
						</Button>
					</div>
				) : null}
				{paging?.error ? (
					<p role="alert" className="px-8 text-feedback-error tr-text-metadata">
						{paging.error}
					</p>
				) : null}
			</section>
		);
	};

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

	const sections = groups.map(section).filter((node) => node !== null);

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
								tone="danger"
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
					{sections.length > 0 ? (
						sections
					) : (
						<p
							data-testid="resources-empty"
							className="px-8 py-4 text-text-subtle tr-text-metadata"
						>
							{t("resources.inspector.empty")}
						</p>
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
						{props.retained
							? t("resources.inspector.retentionWorkspace")
							: t("resources.inspector.retention")}
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
								renderSubagentModel={props.renderSubagentModel}
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
								: props.retained
									? t("resources.inspector.commandFooterRetained")
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
