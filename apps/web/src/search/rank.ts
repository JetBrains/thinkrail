import {
	MATCH_TIER,
	type MatchField,
	type MatchResult,
	type MatchTerm,
	matchFields,
} from "@thinkrail/contracts";
import { adaptiveCounts, frecencyScore, type LearningSnapshot } from "./learning";
import type { PaletteItem, PaletteRow } from "./model";

export interface RankedItem {
	readonly item: PaletteItem;
	readonly match: MatchResult;
	readonly total: number;
	readonly latched: number;
}

const ATTENTION_BOOST = { "needs-input": 25, error: 15, unread: 10, running: 4 } as const;
const TOP_HIT_MARGIN = 25;

export function itemFields(item: PaletteItem): MatchField[] {
	const fields: MatchField[] = [{ key: "title", text: item.title }];
	if (item.subtitle) fields.push({ key: "subtitle", text: item.subtitle, secondary: true });
	if (item.keywords?.length) {
		fields.push({ key: "keywords", text: item.keywords.join(" "), secondary: true });
	}
	return fields;
}

export function matchingIds(
	items: readonly PaletteItem[],
	terms: readonly MatchTerm[],
): ReadonlySet<string> {
	return new Set(
		items.filter((item) => matchFields(terms, itemFields(item)) !== null).map((item) => item.id),
	);
}

export function itemBoost(
	item: PaletteItem,
	learning: LearningSnapshot,
	adaptive: ReadonlyMap<string, number>,
	nowMs: number,
): { boost: number; latched: number } {
	const frecency = frecencyScore(learning, item.id, nowMs);
	const latched = adaptive.get(item.id) ?? 0;
	const boost =
		Math.min(30, 12 * Math.log1p(frecency)) +
		Math.min(40, latched * 8) +
		(item.contextBoost ?? 0) +
		(item.attention ? ATTENTION_BOOST[item.attention] : 0);
	return { boost, latched };
}

export function compareRanked(a: RankedItem, b: RankedItem): number {
	return (
		(a.item.late ?? 0) - (b.item.late ?? 0) || a.match.tier - b.match.tier || b.total - a.total
	);
}

export function rankItems(
	items: readonly PaletteItem[],
	terms: readonly MatchTerm[],
	learning: LearningSnapshot,
	query: string,
	nowMs: number,
): RankedItem[] {
	const ranked: RankedItem[] = [];
	const adaptive = adaptiveCounts(learning, query, nowMs);
	for (const item of items) {
		const match = item.match
			? {
					tier: item.match.tier as MatchResult["tier"],
					score: item.match.score,
					fields: Object.entries(item.match.ranges).map(([key, ranges]) => ({ key, ranges })),
				}
			: matchFields(terms, itemFields(item));
		if (!match) continue;
		const { boost, latched } = itemBoost(item, learning, adaptive, nowMs);
		ranked.push({ item, match, total: match.score * 100 + boost, latched });
	}
	return ranked.sort(compareRanked);
}

export function pickTopHit(ranked: readonly RankedItem[]): RankedItem | null {
	const [best, second] = ranked.filter((entry) => (entry.item.late ?? 0) === 0);
	if (!best) return null;
	if (best.latched >= 2) return best;
	if (best.match.tier > MATCH_TIER.prefix) return null;
	if (!second || second.match.tier > best.match.tier) return best;
	return best.total - second.total >= TOP_HIT_MARGIN ? best : null;
}

export function toRow(ranked: RankedItem, top = false): PaletteRow {
	const ranges: Record<string, readonly (readonly [number, number])[]> = {};
	for (const field of ranked.match.fields) ranges[field.key] = field.ranges;
	return top ? { item: ranked.item, ranges, top } : { item: ranked.item, ranges };
}

export function plainRow(item: PaletteItem): PaletteRow {
	return { item, ranges: {} };
}
