import {
	type RemixiconComponentType,
	RiArrowDownSLine,
	RiCalendarFill,
	RiCalendarLine,
	RiCloseLine,
	RiFilter3Line,
	RiLightbulbFill,
	RiLightbulbLine,
	RiPriceTag3Line,
	RiRefreshLine,
	RiTableFill,
	RiTableLine,
} from "@remixicon/react";
import type { PanelHost, PanelProps } from "@thinkrail/extension-api/web";
import type { MessageKey } from "@thinkrail/locales";
import { localeOf, useT } from "@thinkrail/locales/react";
import type {
	IndexState,
	LabelCount,
	LabelsGetResult,
	SearchFilterKey,
	SessionListRow,
	SessionRef,
	SessionsListResult,
} from "@thinkrail/pi-session-insights/core";
import { Button, IconButton } from "@thinkrail/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@thinkrail/ui/dropdown-menu";
import { useLocalKeys } from "@thinkrail/ui/local-keys";
import { LoadingRegion } from "@thinkrail/ui/skeleton";
import { ToggleSegment } from "@thinkrail/ui/toggle-segment";
import { cn } from "@thinkrail/ui/utils";
import { type ReactNode, useEffect, useEffectEvent, useId, useRef, useState } from "react";
import { ORIGIN_LABEL, sessionName } from "./copy";
import { DayView } from "./day/DayView";
import { FigureBadge } from "./FigureCell";
import { requestSessionFocus } from "./focus";
import { formatCount } from "./format";
import { PANEL_COMMANDS, PANEL_KEYS, PANEL_SCOPE } from "./keys";
import { useLabels } from "./labels/api";
import { LabelsButton } from "./labels/LabelsEditor";
import { type ListTab, onListView, pendingListView, settleListView } from "./listIntent";
import {
	hostServesThisVersion,
	type ListFailure,
	listFailure,
	listScope,
	loadSessions,
	openAnalysis,
	openSession,
	type ScopeKind,
	SESSION_PANEL,
} from "./load";
import { SelectionBar } from "./SelectionBar";
import { type RowLabels, type RowSelection, SessionsTable, type TableView } from "./SessionsTable";
import { ALL_FILTER_KEYS, FILTER_KEYS } from "./search/query";
import { SearchBox } from "./search/SearchBox";
import { SearchView } from "./search/SearchView";
import { useSearch } from "./search/useSearch";
import {
	comparedPair,
	openPicked,
	pickOf,
	type SessionPick,
	swapPicks,
	togglePick,
} from "./selection";
import { FindingsBadge } from "./stats/FindingsBadge";
import { StatsView } from "./stats/StatsView";
import { tallyFindings, useFindings } from "./stats/useFindings";
import { Tabs, tabPanel } from "./Tabs";
import { type ListViewState, readListViewState, showTab, withListIntent } from "./viewState";

const POLL_MS = 1000;

const TABS: readonly {
	id: ListTab;
	icon: RemixiconComponentType;
	active: RemixiconComponentType;
}[] = [
	{ id: "sessions", icon: RiTableLine, active: RiTableFill },
	{ id: "days", icon: RiCalendarLine, active: RiCalendarFill },
	{ id: "insights", icon: RiLightbulbLine, active: RiLightbulbFill },
];

const TAB_LABEL = {
	sessions: "sessionInsights.tab.sessions",
	days: "sessionInsights.tab.days",
	insights: "sessionInsights.tab.insights",
} as const satisfies Record<ListTab, MessageKey>;

/** A set of sessions another view picked ("Show sessions"); the table shows only those. */
export interface SessionFilter {
	label: string;
	ids: ReadonlySet<string>;
}

/** The sessions ticked for a comparison and what the selection bar does with them. */
export interface ListSelection {
	picks: readonly SessionPick[];
	/** The labels a pick's chip shows (the current ones once labels are loaded). */
	labelsOf: (pick: SessionPick) => readonly string[];
	now: number;
	onToggle: (row: SessionListRow) => void;
	onSwap: () => void;
	onClear: () => void;
	onCompare: () => void;
}

export type ListView =
	| { kind: "loading" }
	| { kind: "ready"; result: SessionsListResult; receivedAt: number }
	| { kind: "version" }
	| { kind: "error"; failure: ListFailure };

interface Loaded {
	request: string;
	attempt: number;
	view: ListView;
}

function useSessionsList(
	host: PanelHost,
	scopeKind: ScopeKind,
): { view: ListView; busy: boolean; refresh: () => void } {
	const enabled = hostServesThisVersion(host);
	const request = `${scopeKind}:${host.scope.projectId}`;
	const [attempt, setAttempt] = useState(0);
	const [loaded, setLoaded] = useState<Loaded | null>(null);
	useEffect(() => {
		if (!enabled) return;
		const controller = new AbortController();
		let timer: ReturnType<typeof setTimeout> | undefined;
		const settle = (view: ListView) => setLoaded({ request, attempt, view });
		const run = (fresh: boolean) => {
			loadSessions(host, listScope(host, scopeKind), controller.signal, fresh).then(
				(outcome) => {
					if (controller.signal.aborted) return;
					if (outcome.kind === "version") {
						settle({ kind: "version" });
						return;
					}
					settle({ kind: "ready", result: outcome.result, receivedAt: Date.now() });
					if (outcome.result.state.phase !== "ready") timer = setTimeout(() => run(false), POLL_MS);
				},
				(error: unknown) => {
					if (!controller.signal.aborted) settle({ kind: "error", failure: listFailure(error) });
				},
			);
		};
		run(true);
		return () => {
			controller.abort();
			clearTimeout(timer);
		};
	}, [attempt, enabled, host, request, scopeKind]);
	const refresh = () => setAttempt((current) => current + 1);
	if (!enabled) return { view: { kind: "version" }, busy: false, refresh };
	const current = loaded?.request === request ? loaded : null;
	return {
		view: current?.view ?? { kind: "loading" },
		busy: current !== null && current.attempt !== attempt,
		refresh,
	};
}

function IndexStatus({ state }: { state: IndexState }) {
	const t = useT();
	const locale = localeOf(t);
	if (state.phase === "ready") {
		return (
			<span
				data-testid="session-insights-index"
				data-phase="ready"
				className="truncate tr-text-metadata text-text-subtle"
			>
				{t("sessionInsights.index.ready")}
			</span>
		);
	}
	const label =
		state.total === null
			? t("sessionInsights.index.discovering")
			: t(
					state.phase === "cold"
						? "sessionInsights.index.cold"
						: "sessionInsights.index.refreshing",
					{ indexed: formatCount(locale, state.indexed), total: formatCount(locale, state.total) },
				);
	return (
		<span
			data-testid="session-insights-index"
			data-phase={state.phase}
			className="flex min-w-0 items-center gap-8 tr-text-metadata text-text-muted"
		>
			<span className="truncate">{label}</span>
			<progress
				aria-label={label}
				className="h-2 w-64 shrink-0 accent-primary"
				{...(state.total === null ? {} : { max: Math.max(1, state.total), value: state.indexed })}
			/>
		</span>
	);
}

function Notice({
	testId,
	alert,
	children,
}: {
	testId: string;
	alert?: boolean;
	children: ReactNode;
}) {
	return (
		<div
			data-testid={testId}
			role={alert ? "alert" : undefined}
			className="flex flex-col items-center justify-center gap-8 p-16 text-center tr-text-ui text-text-muted"
		>
			{children}
		</div>
	);
}

const FAILURE_TEXT = {
	disabled: "sessionInsights.error.disabled",
	updateHost: "sessionInsights.updateHost",
	failed: "sessionInsights.error.failed",
} as const;

function filtered(result: SessionsListResult, filter: SessionFilter | null): SessionsListResult {
	return filter
		? { ...result, rows: result.rows.filter((row) => filter.ids.has(row.sessionId)) }
		: result;
}

function FilterBar({ filter, onClear }: { filter: SessionFilter; onClear: () => void }) {
	const t = useT();
	return (
		<div
			data-testid="session-insights-filter"
			className="flex shrink-0 items-center gap-8 border-border-default border-b bg-control-bg px-12 py-4 tr-text-metadata text-text-muted"
		>
			<RiFilter3Line aria-hidden className="size-14 shrink-0" />
			<span className="min-w-0 truncate">
				{t("sessionInsights.filter.label", { label: filter.label, count: filter.ids.size })}
			</span>
			<IconButton
				icon={RiCloseLine}
				size="s"
				label={t("sessionInsights.filter.clear")}
				data-testid="session-insights-filter-clear"
				onClick={onClear}
			/>
		</div>
	);
}

function Legend({ count }: { count: number }) {
	const t = useT();
	return (
		<div className="flex shrink-0 flex-wrap items-center gap-x-12 gap-y-2 border-border-default border-t px-12 py-4 tr-text-metadata text-text-muted">
			<span data-testid="session-insights-count">{t("sessionInsights.count", { count })}</span>
			<span className="inline-flex items-center gap-4">
				<FigureBadge origin="approximated" legend />
				{t(ORIGIN_LABEL.approximated)}
			</span>
			<span className="inline-flex items-center gap-4">
				<FigureBadge origin="notMeasured" legend />
				{t(ORIGIN_LABEL.notMeasured)}
			</span>
			<span className="ml-auto text-text-subtle">{t("sessionInsights.legend.hint")}</span>
		</div>
	);
}

const NO_SELECTION: ListSelection = {
	picks: [],
	labelsOf: (pick) => pick.labels,
	now: 0,
	onToggle: () => {},
	onSwap: () => {},
	onClear: () => {},
	onCompare: () => {},
};

function typingIn(target: EventTarget): boolean {
	return (
		target instanceof HTMLElement &&
		(target.isContentEditable ||
			target instanceof HTMLTextAreaElement ||
			target instanceof HTMLSelectElement ||
			(target instanceof HTMLInputElement && target.type !== "checkbox" && target.type !== "radio"))
	);
}

/** The toolbar's label filter: every label in use with its sessions, or all sessions. */
function LabelFilter({
	vocabulary,
	value,
	onChange,
}: {
	vocabulary: readonly LabelCount[];
	value: string | null;
	onChange: (label: string | null) => void;
}) {
	const t = useT();
	const locale = localeOf(t);
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					variant="ghost"
					size="s"
					iconLeft={RiPriceTag3Line}
					iconRight={RiArrowDownSLine}
					selected={value !== null}
					data-testid="session-insights-label-filter"
					className="max-w-160 min-w-0 shrink-0"
				>
					<span className="min-w-0 truncate">{value ?? t("sessionInsights.labels.filter")}</span>
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="start" className="max-w-320">
				{vocabulary.length === 0 ? (
					<DropdownMenuItem disabled data-testid="session-insights-label-filter-empty">
						{t("sessionInsights.labels.filterNone")}
					</DropdownMenuItem>
				) : (
					<DropdownMenuRadioGroup
						value={value ?? ""}
						onValueChange={(next) => onChange(next === "" ? null : next)}
					>
						<DropdownMenuRadioItem value="" data-testid="session-insights-label-filter-all">
							{t("sessionInsights.labels.filterAll")}
						</DropdownMenuRadioItem>
						<DropdownMenuSeparator />
						{vocabulary.map((entry) => (
							<DropdownMenuRadioItem
								key={entry.label}
								value={entry.label}
								data-testid="session-insights-label-filter-item"
								data-label={entry.label}
							>
								<span className="min-w-0 flex-1 truncate">{entry.label}</span>
								<span className="ml-12 tr-text-caption text-text-subtle">
									{formatCount(locale, entry.sessions)}
								</span>
							</DropdownMenuRadioItem>
						))}
					</DropdownMenuRadioGroup>
				)}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

/** The sessions carrying a label (case-insensitively), from the server's labels. */
export function sessionsLabelled(labels: LabelsGetResult | null, label: string): Set<string> {
	const wanted = label.toLocaleLowerCase();
	return new Set(
		(labels?.sessions ?? [])
			.filter((entry) => entry.labels.some((item) => item.toLocaleLowerCase() === wanted))
			.map((entry) => entry.sessionId),
	);
}

function ListBody({
	view,
	scopeKind,
	busy,
	filter,
	onScope,
	onRetry,
	onOpen,
	onAnalyse,
	selection,
	labels,
	tableView,
	onTableView,
}: {
	view: ListView;
	scopeKind: ScopeKind;
	busy: boolean;
	filter: SessionFilter | null;
	onScope: (kind: ScopeKind) => void;
	onRetry: () => void;
	onOpen: (row: SessionListRow) => void;
	onAnalyse: (row: SessionListRow) => void;
	selection: RowSelection;
	labels: RowLabels | null;
	tableView: TableView | undefined;
	onTableView: ((view: TableView) => void) | undefined;
}) {
	const t = useT();
	switch (view.kind) {
		case "loading":
			return (
				<LoadingRegion
					rows={8}
					label={t("sessionInsights.index.discovering")}
					testId="session-insights-loading"
					className="p-16"
				/>
			);
		case "version":
			return (
				<Notice testId="session-insights-update-host">{t("sessionInsights.updateHost")}</Notice>
			);
		case "error":
			return (
				<Notice testId="session-insights-error" alert>
					<span>{t(FAILURE_TEXT[view.failure])}</span>
					{view.failure === "failed" ? (
						<Button variant="outline" size="m" loading={busy} onClick={onRetry}>
							{t("common.retry")}
						</Button>
					) : null}
				</Notice>
			);
		case "ready": {
			const { result } = view;
			if (result.rows.length === 0 && result.state.phase !== "ready") {
				return (
					<LoadingRegion
						rows={8}
						label={t("sessionInsights.index.discovering")}
						testId="session-insights-loading"
						className="p-16"
					/>
				);
			}
			if (result.rows.length === 0) {
				return (
					<Notice testId="session-insights-empty">
						<span>
							{scopeKind === "project"
								? t("sessionInsights.empty.project")
								: t("sessionInsights.empty.all")}
						</span>
						{scopeKind === "project" ? (
							<Button variant="outline" size="m" onClick={() => onScope("all")}>
								{t("sessionInsights.empty.showAll")}
							</Button>
						) : null}
					</Notice>
				);
			}
			return (
				<SessionsTable
					key={`${scopeKind}:${filter?.label ?? ""}`}
					result={filtered(result, filter)}
					grouped={scopeKind === "all"}
					now={view.receivedAt}
					onOpen={onOpen}
					onAnalyse={onAnalyse}
					selection={selection}
					labels={labels}
					{...(tableView ? { initialView: tableView } : {})}
					{...(onTableView ? { onView: onTableView } : {})}
				/>
			);
		}
	}
}

export function SessionsView({
	view,
	scopeKind,
	busy,
	onScope,
	onRefresh,
	onOpen,
	onAnalyse,
	tab = "sessions",
	showSearch = false,
	onTab,
	insightsBadge,
	day,
	stats,
	filter = null,
	onClearFilter,
	selection = NO_SELECTION,
	searchBox,
	search,
	onSearchKey,
	labels = null,
	labelFilter,
	tableView,
	onTableView,
}: {
	view: ListView;
	scopeKind: ScopeKind;
	busy: boolean;
	onScope: (kind: ScopeKind) => void;
	onRefresh: () => void;
	onOpen: (row: SessionListRow) => void;
	onAnalyse: (row: SessionListRow) => void;
	tab?: ListTab;
	/** The search results are shown in place of the tab's body. */
	showSearch?: boolean;
	onTab?: (tab: ListTab) => void;
	/** The Insights tab's count of findings. */
	insightsBadge?: ReactNode;
	day?: ReactNode;
	stats?: ReactNode;
	filter?: SessionFilter | null;
	onClearFilter?: () => void;
	selection?: ListSelection;
	/** The toolbar's search field. */
	searchBox?: ReactNode;
	search?: ReactNode;
	/** The search key pressed in the panel outside a text field. */
	onSearchKey?: (() => void) | undefined;
	/** The user's labels in the rows (chips and the editor). */
	labels?: RowLabels | null;
	/** The toolbar's label filter, shown with the Sessions tab. */
	labelFilter?: ReactNode;
	/** The table's sort and open groups to start from, and where their changes go. */
	tableView?: TableView;
	onTableView?: (view: TableView) => void;
}) {
	const t = useT();
	const tabsId = useId();
	const local = useLocalKeys(PANEL_SCOPE, PANEL_COMMANDS);
	const [root, setRoot] = useState<HTMLDivElement | null>(null);
	useEffect(() => {
		if (!root || !onSearchKey) return;
		const onKey = (event: KeyboardEvent) => {
			if (local.match(event) !== PANEL_KEYS.search) return;
			event.preventDefault();
			onSearchKey();
		};
		root.addEventListener("keydown", onKey);
		return () => root.removeEventListener("keydown", onKey);
	}, [local, onSearchKey, root]);
	const pair = comparedPair(selection.picks);
	const rowSelection: RowSelection = {
		picked: (sessionId) => selection.picks.some((pick) => pick.sessionId === sessionId),
		onToggle: selection.onToggle,
		onCompare: pair ? selection.onCompare : null,
	};
	const [list, setList] = useState<HTMLDivElement | null>(null);
	const onListKey = useEffectEvent((event: KeyboardEvent) => {
		if (event.key !== "Escape" || event.defaultPrevented || selection.picks.length === 0) return;
		if (event.target === null || typingIn(event.target)) return;
		event.preventDefault();
		selection.onClear();
	});
	useEffect(() => {
		if (!list) return;
		const onKey = (event: KeyboardEvent) => onListKey(event);
		list.addEventListener("keydown", onKey);
		return () => list.removeEventListener("keydown", onKey);
	}, [list]);
	const sessions = (
		<div ref={setList} className="flex min-h-0 flex-1 flex-col">
			{filter ? <FilterBar filter={filter} onClear={() => onClearFilter?.()} /> : null}
			<div className="@container min-h-0 flex-1 overflow-auto">
				<ListBody
					view={view}
					scopeKind={scopeKind}
					busy={busy}
					filter={filter}
					onScope={onScope}
					onRetry={onRefresh}
					onOpen={onOpen}
					onAnalyse={onAnalyse}
					selection={rowSelection}
					labels={labels}
					tableView={tableView}
					onTableView={onTableView}
				/>
			</div>
			<SelectionBar
				picks={selection.picks}
				labelsOf={selection.labelsOf}
				now={selection.now}
				onSwap={selection.onSwap}
				onCompare={selection.onCompare}
				onClear={selection.onClear}
			/>
			{view.kind === "ready" && view.result.rows.length > 0 ? (
				<Legend count={filtered(view.result, filter).rows.length} />
			) : null}
		</div>
	);
	const body = tab === "days" && day ? day : tab === "insights" && stats ? stats : sessions;
	return (
		<div
			ref={setRoot}
			data-testid="session-insights-panel"
			data-key-scope={PANEL_SCOPE}
			className="flex h-full min-h-0 flex-col"
		>
			<div className="flex h-panel-header-row shrink-0 items-center gap-8 overflow-clip border-border-default border-b px-12">
				{onTab ? (
					<Tabs
						id={tabsId}
						label={t("sessionInsights.tab.label")}
						tabs={TABS.map((item) => {
							const Icon = item.id === tab ? item.active : item.icon;
							return {
								id: item.id,
								testId: `session-insights-tab-${item.id}`,
								label: (
									<>
										<Icon aria-hidden className="size-14" />
										{t(TAB_LABEL[item.id])}
										{item.id === "insights" ? insightsBadge : null}
									</>
								),
							};
						})}
						value={tab}
						onChange={onTab}
						className="flex h-full shrink-0 items-center gap-4"
						tabClassName="flex h-full items-center gap-4 px-4"
					/>
				) : null}
				<div
					role="toolbar"
					aria-label={t("sessionInsights.panel.title")}
					className={cn(
						"flex h-full min-w-0 flex-1 items-center gap-4",
						onTab && "border-border-default border-l pl-8",
					)}
				>
					<ToggleSegment
						testid="session-insights-scope-project"
						label={t("sessionInsights.scope.project")}
						active={scopeKind === "project"}
						onClick={() => onScope("project")}
					/>
					<ToggleSegment
						testid="session-insights-scope-all"
						label={t("sessionInsights.scope.all")}
						active={scopeKind === "all"}
						onClick={() => onScope("all")}
					/>
					{labelFilter && tab === "sessions" && !showSearch ? (
						<div className="ml-8 flex shrink-0 items-center">{labelFilter}</div>
					) : null}
					{searchBox ? (
						<div className="ml-8 flex min-w-0 flex-1 items-center">{searchBox}</div>
					) : null}
					<div className="ml-auto flex min-w-0 items-center gap-8">
						{view.kind === "ready" ? <IndexStatus state={view.result.state} /> : null}
						<IconButton
							icon={RiRefreshLine}
							label={t("sessionInsights.refresh")}
							data-testid="session-insights-refresh"
							loading={busy}
							disabled={view.kind === "version"}
							onClick={onRefresh}
						/>
					</div>
				</div>
			</div>
			{showSearch && search ? (
				<div className="flex min-h-0 flex-1 flex-col">{search}</div>
			) : (
				<div {...(onTab ? tabPanel(tabsId, tab) : {})} className="flex min-h-0 flex-1 flex-col">
					{body}
				</div>
			)}
		</div>
	);
}

function panelClient(): string {
	return `panel-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function initialView(host: PanelHost): ListViewState {
	const restored = readListViewState(host.viewState);
	const intent = pendingListView();
	return intent ? withListIntent(restored, intent) : restored;
}

export default function SessionsPanel({ host }: PanelProps) {
	const t = useT();
	const [view, setView] = useState<ListViewState>(() => initialView(host));
	const [searching, setSearching] = useState(false);
	const [client] = useState(panelClient);
	const [now] = useState(() => Date.now());
	const [dayAttempt, setDayAttempt] = useState(0);
	const searchInput = useRef<HTMLInputElement>(null);
	const searchResults = useRef<HTMLDivElement>(null);
	const enabled = hostServesThisVersion(host);
	const scopeKind = view.scope;
	const update = (patch: Partial<ListViewState>) =>
		setView((current) => ({ ...current, ...patch }));
	const save = useEffectEvent((state: ListViewState) => host.saveViewState?.(state));
	useEffect(() => {
		save(view);
	}, [view]);
	useEffect(() => {
		const pending = pendingListView();
		if (pending) settleListView(pending);
		return onListView((intent) => {
			setView((current) => withListIntent(current, intent));
			settleListView(intent);
		});
	}, []);
	const search = useSearch(
		host,
		client,
		listScope(host, scopeKind),
		view.search,
		enabled && (searching || view.results),
	);
	const findings = useFindings(host, scopeKind, dayAttempt, enabled);
	const keys = scopeKind === "all" ? ALL_FILTER_KEYS : FILTER_KEYS;
	const focusSearch = () => searchInput.current?.focus();
	const onSearchText = (text: string) => {
		setSearching(true);
		setView((current) => ({
			...current,
			search: text,
			results: current.results || text.trim() !== "",
		}));
	};
	const leaveSearch = () => update({ search: "", results: false });
	const openAt = (session: SessionRef, eventId: string | null) => {
		if (eventId) requestSessionFocus(session.sessionId, eventId);
		host.openPanel(SESSION_PANEL, { sessionId: session.sessionId }, sessionName(t, session));
	};
	const labels = useLabels(host, null, enabled);
	const filter: SessionFilter | null = view.label
		? {
				label: t("sessionInsights.labels.filterBar", { label: view.label }),
				ids: sessionsLabelled(labels, view.label),
			}
		: view.filter
			? { label: view.filter.label, ids: new Set(view.filter.ids) }
			: null;
	const labelsByRow = new Map((labels?.sessions ?? []).map((entry) => [entry.sessionId, entry]));
	const labelsOf = (sessionId: string) => labelsByRow.get(sessionId)?.labels ?? [];
	const rowLabels: RowLabels | null = labels
		? {
				of: labelsOf,
				edit: (row, cell) => (
					<LabelsButton
						host={host}
						sessionId={row.sessionId}
						labels={labelsOf(row.sessionId)}
						noted={labelsByRow.get(row.sessionId)?.noted ?? false}
						vocabulary={labels.vocabulary}
						data-grid-key={cell.key}
						data-grid-row={cell.row}
						data-grid-col={cell.col}
						tabIndex={cell.tabIndex}
					/>
				),
			}
		: null;
	const { view: list, busy, refresh } = useSessionsList(host, scopeKind);
	const selection: ListSelection = {
		picks: view.picks,
		labelsOf: (pick) => (labels ? labelsOf(pick.sessionId) : pick.labels),
		now,
		onToggle: (row) =>
			setView((current) => ({
				...current,
				picks: togglePick(current.picks, pickOf(row, labelsOf(row.sessionId))),
			})),
		onSwap: () => setView((current) => ({ ...current, picks: swapPicks(current.picks) })),
		onClear: () => update({ picks: [] }),
		onCompare: () => {
			openPicked(host, t, view.picks);
		},
	};
	const findingsView = findings.polled.view;
	const tally =
		findingsView.kind === "ready" && !findings.polled.busy
			? tallyFindings(findingsView.value)
			: null;
	return (
		<SessionsView
			view={list}
			scopeKind={scopeKind}
			busy={busy}
			onScope={(kind) => update({ scope: kind, label: null, filter: null })}
			onRefresh={() => {
				refresh();
				setDayAttempt(dayAttempt + 1);
				if (view.results) search.retry();
			}}
			filter={filter}
			onClearFilter={() => update({ label: null, filter: null })}
			labels={rowLabels}
			labelFilter={
				labels ? (
					<LabelFilter
						vocabulary={labels.vocabulary}
						value={view.label}
						onChange={(label) => update({ filter: null, label })}
					/>
				) : null
			}
			selection={selection}
			tableView={{ sort: view.sort, toggled: view.toggled }}
			onTableView={(table) => update({ sort: table.sort, toggled: table.toggled })}
			onOpen={(row) => {
				openSession(host, row);
			}}
			onAnalyse={(row) => openAnalysis(host, row, sessionName(t, row))}
			tab={view.tab}
			showSearch={view.results}
			onTab={(next) =>
				setView((current) =>
					current.results && next === current.tab
						? { ...current, search: "", results: false }
						: showTab(current, next),
				)
			}
			insightsBadge={
				tally ? (
					<FindingsBadge tally={tally} testId="session-insights-insights-badge" tooltip />
				) : null
			}
			onSearchKey={enabled ? focusSearch : undefined}
			searchBox={
				enabled ? (
					<SearchBox
						value={view.search}
						onChange={onSearchText}
						onFocus={() => setSearching(true)}
						onEscape={() => {
							if (view.search || view.results) leaveSearch();
							else searchInput.current?.blur();
						}}
						onToResults={() => {
							if (!view.results) update({ results: true });
							searchResults.current?.querySelector<HTMLElement>("[data-search-row]")?.focus();
						}}
						vocabulary={search.state.vocabulary}
						keys={keys}
						inputRef={searchInput}
					/>
				) : null
			}
			search={
				enabled ? (
					<SearchView
						controls={search}
						text={view.search}
						onText={onSearchText}
						keys={keys}
						scopeAll={scopeKind === "all"}
						now={now}
						onOpen={openAt}
						onToInput={focusSearch}
						onFilterKey={(key: SearchFilterKey) => {
							const text = view.search.trimEnd();
							const next = text ? `${text} ${key}:` : `${key}:`;
							onSearchText(next);
							requestAnimationFrame(() => {
								const input = searchInput.current;
								if (!input) return;
								input.focus();
								input.setSelectionRange(next.length, next.length);
							});
						}}
						resultsRef={searchResults}
					/>
				) : null
			}
			stats={
				enabled ? (
					<StatsView
						host={host}
						scopeKind={scopeKind}
						attempt={dayAttempt}
						findings={findings}
						view={view.stats}
						onView={(stats) => update({ stats })}
						actions={{
							onShowSessions: (label, ids) =>
								update({
									label: null,
									filter: { label, ids: [...ids] },
									tab: "sessions",
									results: false,
								}),
							onOpenSession: openAt,
							onOpenFile: (workspaceId, path) => host.openFile(workspaceId, path),
						}}
					/>
				) : null
			}
			day={
				enabled ? (
					<DayView
						host={host}
						scopeKind={scopeKind}
						attempt={dayAttempt}
						onOpen={(session) =>
							host.openPanel(
								SESSION_PANEL,
								{ sessionId: session.sessionId },
								sessionName(t, session),
							)
						}
					/>
				) : null
			}
		/>
	);
}
