import type { HotspotSort, SliceBy } from "@thinkrail/pi-session-insights/core";
import type { InsightsSection, ListIntent, ListTab } from "./listIntent";
import type { ScopeKind } from "./load";
import { DEFAULT_SORT, type Sort, type SortKey } from "./rows";
import type { SessionPick } from "./selection";
import type { SliceChoice } from "./stats/api";
import type { HotspotsLayout } from "./stats/HotspotsView";
import type { SequenceView } from "./stats/SequencesView";
import type { UsageBy, UsageMetric } from "./stats/UsageChart";
import type { UsageTab } from "./stats/UsageTables";

/** The usage section's switches; `metric: null` follows the server's headline. */
export interface UsageOptions {
	metric: UsageMetric | null;
	by: UsageBy;
	withOutside: boolean;
	tab: UsageTab;
}

export interface StatsViewState {
	section: InsightsSection;
	hotspotSort: HotspotSort;
	hotspotLayout: HotspotsLayout;
	usage: UsageOptions;
	sequences: SequenceView;
	slices: SliceChoice;
}

/** A set of sessions another view picked ("Show sessions"); the table shows only those. */
export interface SavedFilter {
	label: string;
	ids: readonly string[];
}

/** What the list tab keeps across remounts (`PanelHost.viewState`). */
export interface ListViewState {
	tab: ListTab;
	/** The search results are shown in place of the tab. */
	results: boolean;
	search: string;
	scope: ScopeKind;
	sort: Sort;
	/** Groups opened or closed against their default. */
	toggled: readonly string[];
	label: string | null;
	filter: SavedFilter | null;
	picks: readonly SessionPick[];
	stats: StatsViewState;
}

export const DEFAULT_STATS_VIEW: StatsViewState = {
	section: "findings",
	hotspotSort: "touches",
	hotspotLayout: "list",
	usage: { metric: null, by: "model", withOutside: true, tab: "models" },
	sequences: "matrix",
	slices: { by: "model", a: null, b: null },
};

export const DEFAULT_LIST_VIEW: ListViewState = {
	tab: "sessions",
	results: false,
	search: "",
	scope: "project",
	sort: DEFAULT_SORT,
	toggled: [],
	label: null,
	filter: null,
	picks: [],
	stats: DEFAULT_STATS_VIEW,
};

type Members<T extends string> = Readonly<Record<T, true>>;

const TABS: Members<ListTab> = { sessions: true, days: true, insights: true };
const SECTIONS: Members<InsightsSection> = {
	findings: true,
	usage: true,
	hotspots: true,
	sequences: true,
	ab: true,
};
const SCOPES: Members<ScopeKind> = { project: true, all: true };
const SORT_KEYS: Members<SortKey> = {
	start: true,
	active: true,
	tokens: true,
	cost: true,
	calls: true,
	errors: true,
	subagents: true,
};
const DIRECTIONS: Members<Sort["direction"]> = { asc: true, desc: true };
const HOTSPOT_SORTS: Members<HotspotSort> = { touches: true, changes: true, sessions: true };
const LAYOUTS: Members<HotspotsLayout> = { list: true, tree: true };
const METRICS: Members<UsageMetric> = { cost: true, tokens: true };
const BYS: Members<UsageBy> = { model: true, project: true };
const USAGE_TABS: Members<UsageTab> = {
	models: true,
	projects: true,
	tools: true,
	commands: true,
	skills: true,
	roles: true,
};
const SEQUENCE_VIEWS: Members<SequenceView> = { matrix: true, map: true, errors: true };
const SLICE_BYS: Members<SliceBy> = {
	model: true,
	period: true,
	project: true,
	label: true,
	filter: true,
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMember<T extends string>(members: Members<T>, value: unknown): value is T {
	return typeof value === "string" && Object.hasOwn(members, value);
}

function member<T extends string>(members: Members<T>, value: unknown, fallback: T): T {
	return isMember(members, value) ? value : fallback;
}

function text(value: unknown, fallback: string): string {
	return typeof value === "string" ? value : fallback;
}

function textOrNull(value: unknown): string | null {
	return typeof value === "string" ? value : null;
}

function numberOrNull(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function strings(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}

function readSort(value: unknown): Sort {
	if (!isRecord(value)) return DEFAULT_SORT;
	return {
		key: member(SORT_KEYS, value.key, DEFAULT_SORT.key),
		direction: member(DIRECTIONS, value.direction, DEFAULT_SORT.direction),
	};
}

function readFilter(value: unknown): SavedFilter | null {
	if (!isRecord(value) || typeof value.label !== "string" || !Array.isArray(value.ids)) return null;
	return { label: value.label, ids: strings(value.ids) };
}

function readPick(value: unknown): SessionPick[] {
	if (!isRecord(value) || typeof value.sessionId !== "string") return [];
	return [
		{
			sessionId: value.sessionId,
			title: textOrNull(value.title),
			firstPrompt: textOrNull(value.firstPrompt),
			start: numberOrNull(value.start),
			calls: numberOrNull(value.calls),
			labels: strings(value.labels),
		},
	];
}

function readUsage(value: unknown): UsageOptions {
	const fallback = DEFAULT_STATS_VIEW.usage;
	if (!isRecord(value)) return fallback;
	return {
		metric: isMember(METRICS, value.metric) ? value.metric : null,
		by: member(BYS, value.by, fallback.by),
		withOutside: typeof value.withOutside === "boolean" ? value.withOutside : fallback.withOutside,
		tab: member(USAGE_TABS, value.tab, fallback.tab),
	};
}

function readSlices(value: unknown): SliceChoice {
	const fallback = DEFAULT_STATS_VIEW.slices;
	if (!isRecord(value)) return fallback;
	return {
		by: member(SLICE_BYS, value.by, fallback.by),
		a: textOrNull(value.a),
		b: textOrNull(value.b),
	};
}

function readStats(value: unknown): StatsViewState {
	const fallback = DEFAULT_STATS_VIEW;
	if (!isRecord(value)) return fallback;
	return {
		section: member(SECTIONS, value.section, fallback.section),
		hotspotSort: member(HOTSPOT_SORTS, value.hotspotSort, fallback.hotspotSort),
		hotspotLayout: member(LAYOUTS, value.hotspotLayout, fallback.hotspotLayout),
		usage: readUsage(value.usage),
		sequences: member(SEQUENCE_VIEWS, value.sequences, fallback.sequences),
		slices: readSlices(value.slices),
	};
}

/** The saved view state, field by field: a field of the wrong shape falls back to its default. */
export function readListViewState(value: unknown): ListViewState {
	const fallback = DEFAULT_LIST_VIEW;
	if (!isRecord(value)) return fallback;
	const search = text(value.search, "");
	return {
		tab: member(TABS, value.tab, fallback.tab),
		results: value.results === true && search.trim() !== "",
		search,
		scope: member(SCOPES, value.scope, fallback.scope),
		sort: readSort(value.sort),
		toggled: strings(value.toggled),
		label: textOrNull(value.label),
		filter: readFilter(value.filter),
		picks: Array.isArray(value.picks) ? value.picks.flatMap(readPick) : [],
		stats: readStats(value.stats),
	};
}

/** Shows a tab, as its click does: the search results close, and the table's filters only stay on it. */
export function showTab(view: ListViewState, tab: ListTab): ListViewState {
	const keepFilters = tab === "sessions";
	return {
		...view,
		tab,
		results: false,
		search: "",
		label: keepFilters ? view.label : null,
		filter: keepFilters ? view.filter : null,
	};
}

/** The view another panel asked for (`requestListView`): its tab, and its Insights section if named. */
export function withListIntent(view: ListViewState, intent: ListIntent): ListViewState {
	const shown = showTab(view, intent.tab);
	return intent.section ? { ...shown, stats: { ...shown.stats, section: intent.section } } : shown;
}
