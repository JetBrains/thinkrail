import { RiChatAiLine, RiMoreLine, RiSparkling2Line } from "@remixicon/react";
import type { MessageKey } from "@thinkrail/locales";
import type { Translator } from "@thinkrail/locales/react";
import type { LearningSnapshot } from "./learning";
import type { PaletteAsk, PaletteItem, PaletteRow, PaletteSection, PaletteStart } from "./model";
import { type ParsedQuery, type SearchScope, stripScopePrefix } from "./query";
import { compareRanked, pickTopHit, plainRow, type RankedItem, rankItems, toRow } from "./rank";

export interface StartInput {
	readonly start: PaletteStart;
	readonly text: string;
}

export interface AskInput {
	readonly ask: PaletteAsk;
	readonly text: string;
	readonly disabledReason?: string;
}

export interface SectionsInput {
	readonly t: Translator;
	readonly parsed: ParsedQuery;
	readonly hostOverflow?: Readonly<Record<string, number>>;
	readonly start?: StartInput;
	readonly ask?: AskInput;
	readonly rootItems: readonly PaletteItem[];
	readonly waiting: readonly PaletteItem[];
	readonly actions: readonly PaletteItem[];
	readonly expanded: ReadonlySet<string>;
	readonly learning: LearningSnapshot;
	readonly nowMs: number;
	readonly keep?: string | null;
	readonly currentPlaces?: readonly string[];
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
	start: "search.group.start",
	ask: "search.group.ask",
	files: "search.group.files",
	specs: "search.group.specs",
	sections: "search.group.sections",
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
	keep: string | null = null,
	cap = scoped ? SCOPED_CAP : ALL_SCOPE_CAP,
): PaletteSection {
	const kept = keep === null ? -1 : rows.findIndex((row) => row.item.id === keep);
	const visible = expanded.has(group) ? rows.length : Math.max(cap, kept + 1);
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
	input: SectionsInput,
): PaletteSection[] {
	const hostOverflow = input.hostOverflow ?? {};
	const groups = new Map<string, RankedItem[]>();
	for (const entry of ranked) {
		const bucket = groups.get(entry.item.group) ?? [];
		bucket.push(entry);
		groups.set(entry.item.group, bucket);
	}
	const parts: { first: RankedItem; section: PaletteSection }[] = [];
	for (const [group, entries] of groups) {
		const overflow = hostOverflow[group] ?? 0;
		const section = cappedSection(
			t,
			group,
			entries.map((entry) => toRow(entry)),
			scoped,
			input.expanded,
			overflow,
			input.keep ?? null,
		);
		parts.push(...cohortParts(section, entries, overflow));
	}
	return parts.sort((a, b) => compareRanked(a.first, b.first)).map((part) => part.section);
}

function cohortParts(
	section: PaletteSection,
	entries: readonly RankedItem[],
	overflow: number,
): { first: RankedItem; section: PaletteSection }[] {
	const cohortOf = (entry: RankedItem) => entry.item.late ?? 0;
	const rows = new Map(section.items.map((row) => [row.item.id, row]));
	const parts = new Map<number, { first: RankedItem; items: PaletteRow[] }>();
	const partOf = (entry: RankedItem) => {
		const part = parts.get(cohortOf(entry)) ?? { first: entry, items: [] };
		parts.set(cohortOf(entry), part);
		return part;
	};
	for (const entry of entries) {
		const row = rows.get(entry.item.id);
		if (row) partOf(entry).items.push(row);
	}
	const more = section.items.find((row) => row.item.kind === "more");
	const hidden = entries.filter((entry) => !rows.has(entry.item.id));
	const first = entries[0];
	if (more && first) {
		const newcomers = overflow === 0 && hidden.length > 0 && hidden.every((e) => cohortOf(e) > 0);
		partOf(newcomers ? (hidden[0] ?? first) : first).items.push(more);
	}
	const lowest = Math.min(...parts.keys());
	return [...parts.entries()].map(([cohort, part]) => ({
		first: part.first,
		section:
			cohort === lowest
				? { ...section, items: part.items }
				: { id: `${section.id}:${cohort}`, title: section.title, items: part.items },
	}));
}

function emptyRootSections(input: SectionsInput): PaletteSection[] {
	const { t } = input;
	const { scope } = input.parsed;
	if (scope === "all") {
		const shown = new Set(
			[...input.waiting, ...input.actions].map((item) => item.id).concat(input.currentPlaces ?? []),
		);
		const recent = input.rootItems
			.filter((item) => !shown.has(item.id) && item.kind !== "more")
			.map((item) => ({ item, usedAt: input.learning.lastUsed[item.id] }))
			.filter((entry): entry is { item: PaletteItem; usedAt: number } => entry.usedAt !== undefined)
			.sort((a, b) => b.usedAt - a.usedAt)
			.slice(0, RECENT_LIMIT)
			.map((entry) => plainRow(entry.item));
		const waiting = cappedSection(
			t,
			"waiting",
			input.waiting.map(plainRow),
			true,
			input.expanded,
			0,
			input.keep ?? null,
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
		cappedSection(t, group, rows, true, input.expanded, 0, input.keep ?? null),
	);
}

export const START_ROW_ID = "start";

export function startRow(t: Translator, input: StartInput): PaletteItem {
	const { start, text } = input;
	return {
		id: START_ROW_ID,
		kind: "start",
		title: t("search.start.title", { text }),
		subtitle: t("search.start.subtitle"),
		group: "start",
		scope: "all",
		icon: RiSparkling2Line,
		shortcut: { key: "↵", mod: true },
		run: () => start.openDialog(text),
	};
}

/** The one rule for the Start work row and the `Mod+↵` shortcut: a typed query in the All or Work scope. */
export function startEligible(parsed: ParsedQuery): boolean {
	return (
		parsed.terms.length > 0 &&
		parsed.text.trim().length > 0 &&
		(parsed.scope === "all" || parsed.scope === "work")
	);
}

/** The prompt is the text as typed — only a scope prefix stripped, whitespace and tokens untouched. */
export function startPrompt(raw: string): string {
	return stripScopePrefix(raw).trim();
}

function onlyLate(section: PaletteSection): boolean {
	return section.items.every((row) => row.item.kind === "more" || (row.item.late ?? 0) > 0);
}

function beforeLate(sections: PaletteSection[], row: PaletteSection): PaletteSection[] {
	const late = sections.findIndex(onlyLate);
	return late === -1
		? [...sections, row]
		: [...sections.slice(0, late), row, ...sections.slice(late)];
}

function withStart(sections: PaletteSection[], input: SectionsInput): PaletteSection[] {
	const { start, parsed, t } = input;
	if (!start || !startEligible(parsed)) return sections;
	return beforeLate(sections, {
		id: "start",
		title: groupLabel(t, "start"),
		items: [plainRow(startRow(t, start))],
	});
}

export const ASK_ROW_ID = "ask";

export function askRow(t: Translator, input: AskInput): PaletteItem {
	const { ask, text, disabledReason } = input;
	return {
		id: ASK_ROW_ID,
		kind: "ask",
		title: t("search.ask.title", { text }),
		subtitle: ask.target
			? t("search.ask.subtitle", { workspace: ask.target })
			: t("search.ask.subtitleHere"),
		group: "ask",
		scope: "specs",
		icon: RiChatAiLine,
		shortcut: { key: "↵", alt: true },
		...(disabledReason ? { disabledReason } : {}),
		run: () => ask.ask(text),
	};
}

export function askEligible(parsed: ParsedQuery): boolean {
	return parsed.text.trim().length > 0 && parsed.scope === "specs";
}

function withAsk(sections: PaletteSection[], input: SectionsInput): PaletteSection[] {
	const { ask, parsed, t } = input;
	if (!ask || !askEligible(parsed)) return sections;
	return beforeLate(sections, {
		id: "ask",
		title: groupLabel(t, "ask"),
		items: [plainRow(askRow(t, ask))],
	});
}

export interface RankedSections {
	readonly rest: readonly RankedItem[];
	readonly top: RankedItem | null;
}

export function rankSections(
	input: Pick<SectionsInput, "parsed" | "rootItems" | "learning" | "nowMs">,
): RankedSections | null {
	const { parsed } = input;
	if (parsed.terms.length === 0) return null;
	const candidates = input.rootItems.filter((item) => inScope(item, parsed.scope));
	const ranked = rankItems(candidates, parsed.terms, input.learning, parsed.text, input.nowMs);
	const top = parsed.scope === "all" ? pickTopHit(ranked) : null;
	return { rest: top ? ranked.filter((entry) => entry !== top) : ranked, top };
}

export function groupSections(
	ranked: RankedSections | null,
	input: SectionsInput,
): PaletteSection[] {
	const { t, parsed } = input;
	if (!ranked) return withAsk(emptyRootSections(input), input);
	const sections = groupRanked(t, ranked.rest, parsed.scope !== "all", input);
	return withAsk(
		withStart(
			ranked.top
				? [
						{ id: "top", title: groupLabel(t, "top"), items: [toRow(ranked.top, true)] },
						...sections,
					]
				: sections,
			input,
		),
		input,
	);
}

export function buildSections(input: SectionsInput): PaletteSection[] {
	return groupSections(rankSections(input), input);
}

export function flattenRows(sections: readonly PaletteSection[]): PaletteRow[] {
	return sections.flatMap((section) => section.items);
}
