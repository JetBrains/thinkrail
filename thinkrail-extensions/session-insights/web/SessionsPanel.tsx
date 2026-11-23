import {
	RiArrowDownSLine,
	RiArrowLeftRightLine,
	RiBarChartGroupedLine,
	RiCalendarLine,
	RiCloseLine,
	RiFilter3Line,
	RiPriceTag3Line,
	RiRefreshLine,
	RiTableLine,
} from "@remixicon/react";
import type { PanelHost, PanelProps } from "@thinkrail/extension-api/web";
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
import { type ReactNode, useEffect, useRef, useState } from "react";
import { ORIGIN_LABEL, sessionName } from "./copy";
import { DayView } from "./day/DayView";
import { FigureBadge } from "./FigureCell";
import { requestSessionFocus } from "./focus";
import { formatCount } from "./format";
import { PANEL_COMMANDS, PANEL_KEYS, PANEL_SCOPE } from "./keys";
import { useLabels } from "./labels/api";
import { LabelsButton } from "./labels/LabelsEditor";
import {
	hostServesThisVersion,
	type ListFailure,
	listFailure,
	listScope,
	loadSessions,
	openAnalysis,
	openComparison,
	openSession,
	type ScopeKind,
	SESSION_PANEL,
} from "./load";
import { type CompareState, type RowLabels, SessionsTable } from "./SessionsTable";
import { ALL_FILTER_KEYS, FILTER_KEYS } from "./search/query";
import { SearchBox } from "./search/SearchBox";
import { SearchView } from "./search/SearchView";
import { useSearch } from "./search/useSearch";
import { StatsView } from "./stats/StatsView";

const POLL_MS = 1000;

/** The list as a sortable table, one day's sessions on a shared time strip, statistics, or search results. */
export type ListMode = "table" | "day" | "stats" | "search";

/** A set of sessions another view picked ("Show sessions"); the table shows only those. */
export interface SessionFilter {
	label: string;
	ids: ReadonlySet<string>;
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

const NO_COMPARE: CompareState = { from: null, onCompare: () => {}, onCancel: () => {} };

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
	compare,
	labels,
}: {
	view: ListView;
	scopeKind: ScopeKind;
	busy: boolean;
	filter: SessionFilter | null;
	onScope: (kind: ScopeKind) => void;
	onRetry: () => void;
	onOpen: (row: SessionListRow) => void;
	onAnalyse: (row: SessionListRow) => void;
	compare: CompareState;
	labels: RowLabels | null;
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
					compare={compare}
					labels={labels}
				/>
			);
		}
	}
}

function CompareBar({ name, onCancel }: { name: string; onCancel: () => void }) {
	const t = useT();
	return (
		<div
			data-testid="session-insights-compare-bar"
			className="flex shrink-0 items-center gap-8 border-border-default border-b bg-control-bg px-12 py-4 tr-text-metadata text-text-muted"
		>
			<RiArrowLeftRightLine aria-hidden className="size-14 shrink-0" />
			<span className="min-w-0 truncate">{t("sessionInsights.compare.picking", { name })}</span>
			<IconButton
				icon={RiCloseLine}
				size="s"
				label={t("sessionInsights.compare.cancel")}
				data-testid="session-insights-compare-cancel"
				onClick={onCancel}
			/>
		</div>
	);
}

export function SessionsView({
	view,
	scopeKind,
	busy,
	onScope,
	onRefresh,
	onOpen,
	onAnalyse,
	mode = "table",
	onMode,
	day,
	stats,
	filter = null,
	onClearFilter,
	compare = NO_COMPARE,
	compareName = null,
	searchBox,
	search,
	onSearchKey,
	labels = null,
	labelFilter,
}: {
	view: ListView;
	scopeKind: ScopeKind;
	busy: boolean;
	onScope: (kind: ScopeKind) => void;
	onRefresh: () => void;
	onOpen: (row: SessionListRow) => void;
	onAnalyse: (row: SessionListRow) => void;
	mode?: ListMode;
	onMode?: (mode: ListMode) => void;
	day?: ReactNode;
	stats?: ReactNode;
	filter?: SessionFilter | null;
	onClearFilter?: () => void;
	compare?: CompareState;
	/** The first side's name while the user picks the second. */
	compareName?: string | null;
	/** The toolbar's search field. */
	searchBox?: ReactNode;
	search?: ReactNode;
	/** The search key pressed in the panel outside a text field. */
	onSearchKey?: (() => void) | undefined;
	/** The user's labels in the rows (chips and the editor). */
	labels?: RowLabels | null;
	/** The toolbar's label filter, shown with the table. */
	labelFilter?: ReactNode;
}) {
	const t = useT();
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
	return (
		<div
			ref={setRoot}
			data-testid="session-insights-panel"
			data-key-scope={PANEL_SCOPE}
			className="flex h-full min-h-0 flex-col"
		>
			<div
				role="toolbar"
				aria-label={t("sessionInsights.panel.title")}
				className="flex h-panel-header-row shrink-0 items-center gap-4 overflow-clip border-border-default border-b px-12"
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
				{onMode ? (
					<fieldset
						aria-label={t("sessionInsights.mode.label")}
						className="ml-8 flex items-center gap-2 border-border-default border-l pl-8"
					>
						<IconButton
							icon={RiTableLine}
							size="s"
							label={t("sessionInsights.mode.table")}
							data-testid="session-insights-mode-table"
							aria-pressed={mode === "table"}
							selected={mode === "table"}
							onClick={() => onMode("table")}
						/>
						<IconButton
							icon={RiCalendarLine}
							size="s"
							label={t("sessionInsights.mode.day")}
							data-testid="session-insights-mode-day"
							aria-pressed={mode === "day"}
							selected={mode === "day"}
							onClick={() => onMode("day")}
						/>
						<IconButton
							icon={RiBarChartGroupedLine}
							size="s"
							label={t("sessionInsights.mode.stats")}
							data-testid="session-insights-mode-stats"
							aria-pressed={mode === "stats"}
							selected={mode === "stats"}
							onClick={() => onMode("stats")}
						/>
					</fieldset>
				) : null}
				{labelFilter && mode === "table" ? (
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
			{mode === "search" && search ? (
				<div className="flex min-h-0 flex-1 flex-col">{search}</div>
			) : mode === "day" && day ? (
				<div className="flex min-h-0 flex-1 flex-col">{day}</div>
			) : mode === "stats" && stats ? (
				<div className="flex min-h-0 flex-1 flex-col">{stats}</div>
			) : (
				<>
					{filter ? <FilterBar filter={filter} onClear={() => onClearFilter?.()} /> : null}
					{compare.from && compareName ? (
						<CompareBar name={compareName} onCancel={compare.onCancel} />
					) : null}
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
							compare={compare}
							labels={labels}
						/>
					</div>
					{view.kind === "ready" && view.result.rows.length > 0 ? (
						<Legend count={filtered(view.result, filter).rows.length} />
					) : null}
				</>
			)}
		</div>
	);
}

function panelClient(): string {
	return `panel-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export default function SessionsPanel({ host }: PanelProps) {
	const t = useT();
	const [scopeKind, setScopeKind] = useState<ScopeKind>("project");
	const [mode, setMode] = useState<ListMode>("table");
	const [listMode, setListMode] = useState<Exclude<ListMode, "search">>("table");
	const [searchText, setSearchText] = useState("");
	const [searching, setSearching] = useState(false);
	const [client] = useState(panelClient);
	const [now] = useState(() => Date.now());
	const searchInput = useRef<HTMLInputElement>(null);
	const searchResults = useRef<HTMLDivElement>(null);
	const enabled = hostServesThisVersion(host);
	const search = useSearch(
		host,
		client,
		listScope(host, scopeKind),
		searchText,
		enabled && searching,
	);
	const keys = scopeKind === "all" ? ALL_FILTER_KEYS : FILTER_KEYS;
	const focusSearch = () => searchInput.current?.focus();
	const onSearchText = (text: string) => {
		setSearchText(text);
		setSearching(true);
		if (text.trim() && mode !== "search") setMode("search");
	};
	const leaveSearch = () => {
		setSearchText("");
		setMode(listMode);
	};
	const openAt = (session: SessionRef, eventId: string | null) => {
		if (eventId) requestSessionFocus(session.sessionId, eventId);
		host.openPanel(SESSION_PANEL, { sessionId: session.sessionId }, sessionName(t, session));
	};
	const [dayAttempt, setDayAttempt] = useState(0);
	const [shown, setFilter] = useState<SessionFilter | null>(null);
	const [labelFilter, setLabelFilter] = useState<string | null>(null);
	const labels = useLabels(host, null, enabled);
	const filter: SessionFilter | null = labelFilter
		? {
				label: t("sessionInsights.labels.filterBar", { label: labelFilter }),
				ids: sessionsLabelled(labels, labelFilter),
			}
		: shown;
	const clearFilters = () => {
		setFilter(null);
		setLabelFilter(null);
	};
	const labelsByRow = new Map((labels?.sessions ?? []).map((entry) => [entry.sessionId, entry]));
	const rowLabels: RowLabels | null = labels
		? {
				of: (sessionId) => labelsByRow.get(sessionId)?.labels ?? [],
				edit: (row, cell) => (
					<LabelsButton
						host={host}
						sessionId={row.sessionId}
						labels={labelsByRow.get(row.sessionId)?.labels ?? []}
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
	const [compareFrom, setCompareFrom] = useState<{ id: string; name: string } | null>(null);
	const { view, busy, refresh } = useSessionsList(host, scopeKind);
	const onCompare = (row: SessionListRow) => {
		if (!compareFrom) {
			setCompareFrom({ id: row.sessionId, name: sessionName(t, row) });
			return;
		}
		setCompareFrom(null);
		if (compareFrom.id === row.sessionId) return;
		openComparison(
			host,
			compareFrom.id,
			row.sessionId,
			t("sessionInsights.compare.tabTitle", { a: compareFrom.name, b: sessionName(t, row) }),
		);
	};
	return (
		<SessionsView
			view={view}
			scopeKind={scopeKind}
			busy={busy}
			onScope={(kind) => {
				setScopeKind(kind);
				clearFilters();
				setCompareFrom(null);
			}}
			onRefresh={() => {
				refresh();
				setDayAttempt(dayAttempt + 1);
				if (mode === "search") search.retry();
			}}
			filter={filter}
			onClearFilter={clearFilters}
			labels={rowLabels}
			labelFilter={
				labels ? (
					<LabelFilter
						vocabulary={labels.vocabulary}
						value={labelFilter}
						onChange={(label) => {
							setFilter(null);
							setLabelFilter(label);
						}}
					/>
				) : null
			}
			compare={{ from: compareFrom?.id ?? null, onCompare, onCancel: () => setCompareFrom(null) }}
			compareName={compareFrom?.name ?? null}
			onOpen={(row) => {
				openSession(host, row);
			}}
			onAnalyse={(row) => openAnalysis(host, row, sessionName(t, row))}
			mode={mode}
			onMode={(next) => {
				setMode(next);
				if (next !== "search") {
					setListMode(next);
					setSearchText("");
				}
				if (next !== "table") clearFilters();
			}}
			onSearchKey={enabled ? focusSearch : undefined}
			searchBox={
				enabled ? (
					<SearchBox
						value={searchText}
						onChange={onSearchText}
						onFocus={() => setSearching(true)}
						onEscape={() => {
							if (searchText || mode === "search") leaveSearch();
							else searchInput.current?.blur();
						}}
						onToResults={() => {
							if (mode !== "search") setMode("search");
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
						text={searchText}
						onText={onSearchText}
						keys={keys}
						scopeAll={scopeKind === "all"}
						now={now}
						onOpen={openAt}
						onToInput={focusSearch}
						onFilterKey={(key: SearchFilterKey) => {
							const text = searchText.trimEnd();
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
				hostServesThisVersion(host) ? (
					<StatsView
						host={host}
						scopeKind={scopeKind}
						attempt={dayAttempt}
						actions={{
							onShowSessions: (label, ids) => {
								setLabelFilter(null);
								setFilter({ label, ids: new Set(ids) });
								setMode("table");
								setListMode("table");
							},
							onOpenSession: openAt,
							onOpenFile: (workspaceId, path) => host.openFile(workspaceId, path),
						}}
					/>
				) : null
			}
			day={
				hostServesThisVersion(host) ? (
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
