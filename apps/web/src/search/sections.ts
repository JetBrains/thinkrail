import { RiFilter3Line, RiMoreLine } from "@remixicon/react";
import type { MessageKey } from "@thinkrail/locales";
import type { Translator } from "@thinkrail/locales/react";
import { frecencyScore, type LearningSnapshot } from "./learning";
import type { PaletteItem, PaletteRow, PaletteSection } from "./model";
import { type ParsedQuery, type SearchScope, STATE_FILTERS, type StateFilter } from "./query";
import { compareRanked, pickTopHit, plainRow, type RankedItem, rankItems, toRow } from "./rank";

export interface PalettePageSection {
	readonly title: string;
	readonly items: readonly PaletteItem[];
}

export interface PalettePage {
	readonly id: string;
	readonly crumb: readonly string[];
	readonly placeholder: string;
	readonly sections: () => readonly PalettePageSection[];
}

export interface SectionsInput {
	readonly t: Translator;
	readonly parsed: ParsedQuery;
	readonly page: PalettePage | null;
	readonly rootItems: readonly PaletteItem[];
	readonly waiting: readonly PaletteItem[];
	readonly actions: readonly PaletteItem[];
	readonly expanded: ReadonlySet<string>;
	readonly learning: LearningSnapshot;
	readonly nowMs: number;
}

const GROUP_LABELS: Readonly<Record<string, MessageKey>> = {
	top: "search.group.top",
	waiting: "search.group.waiting",
	recent: "search.group.recent",
	actions: "search.group.actions",
	workspaces: "search.group.workspaces",
	chats: "search.group.chats",
	projects: "search.group.projects",
	commands: "search.group.commands",
	settings: "search.group.settings",
	mcp: "search.group.mcp",
	extensions: "search.group.extensions",
	themes: "search.group.themes",
	files: "search.group.files",
	specs: "search.group.specs",
	plans: "search.group.plans",
	transcripts: "search.group.transcripts",
	filters: "search.group.filters",
};

const FILTER_LABELS: Record<StateFilter, MessageKey> = {
	"is:waiting": "search.filter.waiting",
	"is:error": "search.filter.error",
	"is:unread": "search.filter.unread",
	"is:running": "search.filter.running",
	"is:settled": "search.filter.settled",
	"has:pr": "search.filter.pr",
};

export function groupLabel(t: Translator, group: string): string {
	const key = GROUP_LABELS[group];
	return key ? t(key) : group;
}

const ALL_SCOPE_CAP = 4;
const SCOPED_CAP = 30;
const RECENT_LIMIT = 5;

function matchesFilter(item: PaletteItem, filter: StateFilter): boolean {
	switch (filter) {
		case "is:waiting":
			return item.states?.includes("waiting") === true;
		case "is:error":
			return item.states?.includes("error") === true;
		case "is:unread":
			return item.states?.includes("unread") === true;
		case "is:running":
			return item.states?.includes("running") === true;
		case "is:settled":
			return item.kind === "workspace" && item.settled === true;
		case "has:pr":
			return item.kind === "workspace" && item.hasPr === true;
	}
}

function inScope(item: PaletteItem, scope: SearchScope): boolean {
	return scope === "all" || item.scope === scope;
}

function filterSuggestions(
	t: Translator,
	partial: string,
	items: readonly PaletteItem[],
): PaletteSection {
	const rows = STATE_FILTERS.filter((filter) => filter.startsWith(partial)).map((filter) =>
		plainRow({
			id: `filter:${filter}`,
			kind: "filter",
			title: filter,
			subtitle: t(FILTER_LABELS[filter]),
			meta: String(items.filter((item) => matchesFilter(item, filter)).length),
			group: "filters",
			scope: "work",
			icon: RiFilter3Line,
			fillQuery: `${filter} `,
		}),
	);
	return { id: "filters", title: groupLabel(t, "filters"), items: rows };
}

function moreRow(
	t: Translator,
	group: string,
	hidden: readonly PaletteRow[],
	scoped: boolean,
): PaletteRow {
	const first = hidden[0]?.item;
	return plainRow({
		id: `more:${group}`,
		kind: "more",
		title: scoped
			? t("search.more.scoped", { count: hidden.length })
			: t("search.more.inGroup", { count: hidden.length, group: groupLabel(t, group) }),
		group,
		scope: first?.scope ?? "all",
		icon: RiMoreLine,
		more: scoped
			? { kind: "expand", group, nextId: first?.id ?? "" }
			: { kind: "scope", scope: first?.scope ?? "all" },
	});
}

function cappedSection(
	t: Translator,
	group: string,
	rows: readonly PaletteRow[],
	scoped: boolean,
	expanded: ReadonlySet<string>,
): PaletteSection {
	const cap = expanded.has(group) ? rows.length : scoped ? SCOPED_CAP : ALL_SCOPE_CAP;
	const title = groupLabel(t, group);
	if (rows.length <= cap) return { id: group, title, items: rows };
	return {
		id: group,
		title,
		meta: String(rows.length),
		items: [...rows.slice(0, cap), moreRow(t, group, rows.slice(cap), scoped)],
	};
}

function groupRanked(
	t: Translator,
	ranked: readonly RankedItem[],
	scoped: boolean,
	expanded: ReadonlySet<string>,
): PaletteSection[] {
	const groups = new Map<string, RankedItem[]>();
	for (const entry of ranked) {
		const bucket = groups.get(entry.item.group) ?? [];
		bucket.push(entry);
		groups.set(entry.item.group, bucket);
	}
	return [...groups.entries()]
		.sort(([, a], [, b]) => (a[0] && b[0] ? compareRanked(a[0], b[0]) : 0))
		.map(([group, entries]) =>
			cappedSection(
				t,
				group,
				entries.map((entry) => toRow(entry)),
				scoped,
				expanded,
			),
		);
}

function pageSections(page: PalettePage, input: SectionsInput): PaletteSection[] {
	const { terms, raw } = input.parsed;
	return page
		.sections()
		.map((section, index) => {
			const rows =
				terms.length === 0
					? section.items.map(plainRow)
					: rankItems(section.items, terms, input.learning, raw, input.nowMs).map((entry) =>
							toRow(entry),
						);
			return { id: `page:${index}`, title: section.title, items: rows };
		})
		.filter((section) => section.items.length > 0);
}

function emptyRootSections(input: SectionsInput): PaletteSection[] {
	const { t } = input;
	const { scope } = input.parsed;
	if (scope === "all") {
		const shown = new Set([...input.waiting, ...input.actions].map((item) => item.id));
		const recent = input.rootItems
			.filter((item) => !shown.has(item.id) && item.kind !== "more")
			.map((item) => ({ item, frecency: frecencyScore(input.learning, item.id, input.nowMs) }))
			.filter((entry) => entry.frecency > 0.05)
			.sort((a, b) => b.frecency - a.frecency)
			.slice(0, RECENT_LIMIT)
			.map((entry) => plainRow(entry.item));
		return [
			{
				id: "waiting",
				title: groupLabel(t, "waiting"),
				meta: t("search.group.waitingMeta"),
				items: input.waiting.map(plainRow),
			},
			{ id: "recent", title: groupLabel(t, "recent"), items: recent },
			{ id: "actions", title: groupLabel(t, "actions"), items: input.actions.map(plainRow) },
		].filter((section) => section.items.length > 0);
	}
	const groups = new Map<string, PaletteRow[]>();
	for (const item of input.rootItems) {
		if (!inScope(item, scope)) continue;
		const rows = groups.get(item.group) ?? [];
		rows.push(plainRow(item));
		groups.set(item.group, rows);
	}
	return [...groups.entries()].map(([group, rows]) =>
		cappedSection(t, group, rows, true, input.expanded),
	);
}

export function buildSections(input: SectionsInput): PaletteSection[] {
	const { t, parsed } = input;
	if (input.page) return pageSections(input.page, input);
	if (parsed.partialFilter !== null && parsed.filters.length === 0 && parsed.terms.length === 0) {
		return [filterSuggestions(t, parsed.partialFilter, input.rootItems)];
	}
	let candidates = input.rootItems.filter((item) => inScope(item, parsed.scope));
	if (parsed.filters.length > 0) {
		candidates = candidates.filter((item) =>
			parsed.filters.every((filter) => matchesFilter(item, filter)),
		);
		if (parsed.terms.length === 0) {
			return groupRanked(
				t,
				rankItems(candidates, [], input.learning, "", input.nowMs),
				true,
				input.expanded,
			);
		}
	} else if (parsed.terms.length === 0) {
		return emptyRootSections(input);
	}
	const ranked = rankItems(candidates, parsed.terms, input.learning, parsed.raw, input.nowMs);
	const scoped = parsed.scope !== "all" || parsed.filters.length > 0;
	const top = scoped ? null : pickTopHit(ranked);
	const rest = top ? ranked.filter((entry) => entry !== top) : ranked;
	const sections = groupRanked(t, rest, scoped, input.expanded);
	return top
		? [{ id: "top", title: groupLabel(t, "top"), items: [toRow(top, true)] }, ...sections]
		: sections;
}

export function flattenRows(sections: readonly PaletteSection[]): PaletteRow[] {
	return sections.flatMap((section) => section.items);
}
