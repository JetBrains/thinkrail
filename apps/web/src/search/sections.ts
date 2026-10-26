import { RiMoreLine } from "@remixicon/react";
import type { MessageKey } from "@thinkrail/locales";
import type { Translator } from "@thinkrail/locales/react";
import { frecencyScore, type LearningSnapshot } from "./learning";
import type { PaletteItem, PaletteRow, PaletteSection } from "./model";
import type { ParsedQuery, SearchScope } from "./query";
import { compareRanked, pickTopHit, plainRow, type RankedItem, rankItems, toRow } from "./rank";

export interface SectionsInput {
	readonly t: Translator;
	readonly parsed: ParsedQuery;
	/** Host hits per group beyond the page the host returned (`total − hits`), so a cap can say how many more exist. */
	readonly hostOverflow?: Readonly<Record<string, number>>;
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
	files: "search.group.files",
	specs: "search.group.specs",
	plans: "search.group.plans",
	transcripts: "search.group.transcripts",
};

export function groupLabel(t: Translator, group: string): string {
	const key = GROUP_LABELS[group];
	return key ? t(key) : group;
}

const ALL_SCOPE_CAP = 4;
const SCOPED_CAP = 30;
const WAITING_CAP = 8;
const RECENT_LIMIT = 5;

function inScope(item: PaletteItem, scope: SearchScope): boolean {
	return scope === "all" || item.scope === scope;
}

function moreRow(
	t: Translator,
	group: string,
	scope: SearchScope,
	hidden: readonly PaletteRow[],
	scoped: boolean,
	overflow: number,
): PaletteRow {
	const first = hidden[0]?.item;
	return plainRow({
		id: `more:${group}`,
		kind: "more",
		title: scoped
			? t("search.more.scoped", { count: hidden.length })
			: t("search.more.inGroup", { count: hidden.length + overflow, group: groupLabel(t, group) }),
		group,
		scope,
		icon: RiMoreLine,
		more: scoped ? { kind: "expand", group, nextId: first?.id ?? "" } : { kind: "scope", scope },
	});
}

function cappedSection(
	t: Translator,
	group: string,
	rows: readonly PaletteRow[],
	scoped: boolean,
	expanded: ReadonlySet<string>,
	overflow: number,
	cap = scoped ? SCOPED_CAP : ALL_SCOPE_CAP,
): PaletteSection {
	const visible = expanded.has(group) ? rows.length : cap;
	const title = groupLabel(t, group);
	if (rows.length <= visible && overflow === 0) return { id: group, title, items: rows };
	const scope = rows[0]?.item.scope ?? "all";
	const hidden = rows.slice(visible);
	const shown = rows.slice(0, visible);
	const total = rows.length + overflow;
	const items =
		scoped && hidden.length === 0
			? shown
			: [...shown, moreRow(t, group, scope, hidden, scoped, overflow)];
	return {
		id: group,
		title,
		meta:
			scoped && overflow > 0
				? t("search.group.hostCapped", { count: total, shown: rows.length })
				: String(total),
		items,
	};
}

function groupRanked(
	t: Translator,
	ranked: readonly RankedItem[],
	scoped: boolean,
	expanded: ReadonlySet<string>,
	hostOverflow: Readonly<Record<string, number>>,
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
				hostOverflow[group] ?? 0,
			),
		);
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
		const waiting = cappedSection(
			t,
			"waiting",
			input.waiting.map(plainRow),
			true,
			input.expanded,
			0,
			WAITING_CAP,
		);
		return [
			{ ...waiting, meta: t("search.group.waitingMeta") },
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
		cappedSection(t, group, rows, true, input.expanded, 0),
	);
}

export function buildSections(input: SectionsInput): PaletteSection[] {
	const { t, parsed } = input;
	if (parsed.terms.length === 0) return emptyRootSections(input);
	const candidates = input.rootItems.filter((item) => inScope(item, parsed.scope));
	const ranked = rankItems(candidates, parsed.terms, input.learning, parsed.text, input.nowMs);
	const scoped = parsed.scope !== "all";
	const top = scoped ? null : pickTopHit(ranked);
	const rest = top ? ranked.filter((entry) => entry !== top) : ranked;
	const sections = groupRanked(t, rest, scoped, input.expanded, input.hostOverflow ?? {});
	return top
		? [{ id: "top", title: groupLabel(t, "top"), items: [toRow(top, true)] }, ...sections]
		: sections;
}

export function flattenRows(sections: readonly PaletteSection[]): PaletteRow[] {
	return sections.flatMap((section) => section.items);
}
