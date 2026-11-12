import { sameModel, type WireModel } from "@thinkrail/contracts";
import type { MessageKey } from "@thinkrail/locales";
import type { Translator } from "@thinkrail/locales/react";
import type { ModelRef } from "@/store";
import { groupByProvider, modelKey, type ProviderGroup } from "./modelPicker";

const SCORE_CONTINUE_MATCH = 1;
const SCORE_SPACE_WORD_JUMP = 0.9;
const SCORE_NON_SPACE_WORD_JUMP = 0.8;
const SCORE_CHARACTER_JUMP = 0.17;
const SCORE_TRANSPOSITION = 0.1;
const PENALTY_SKIPPED = 0.999;
const PENALTY_CASE_MISMATCH = 0.9999;
const PENALTY_NOT_COMPLETE = 0.99;
const IS_GAP = /[\\/_+.#"@[({&]/;
const COUNT_GAPS = /[\\/_+.#"@[({&]/g;
const IS_SPACE = /[\s-]/;
const COUNT_SPACES = /[\s-]/g;

function scoreFrom(
	text: string,
	query: string,
	lowerText: string,
	lowerQuery: string,
	textIndex: number,
	queryIndex: number,
	memo: Map<string, number>,
): number {
	if (queryIndex === query.length) {
		return textIndex === text.length ? SCORE_CONTINUE_MATCH : PENALTY_NOT_COMPLETE;
	}
	const memoKey = `${textIndex},${queryIndex}`;
	const memoized = memo.get(memoKey);
	if (memoized !== undefined) return memoized;
	const queryChar = lowerQuery.charAt(queryIndex);
	let index = lowerText.indexOf(queryChar, textIndex);
	let best = 0;
	while (index >= 0) {
		let score = scoreFrom(text, query, lowerText, lowerQuery, index + 1, queryIndex + 1, memo);
		if (score > best) {
			if (index === textIndex) {
				score *= SCORE_CONTINUE_MATCH;
			} else if (IS_GAP.test(text.charAt(index - 1))) {
				score *= SCORE_NON_SPACE_WORD_JUMP;
				const gaps = text.slice(textIndex, index - 1).match(COUNT_GAPS);
				if (gaps && textIndex > 0) score *= PENALTY_SKIPPED ** gaps.length;
			} else if (IS_SPACE.test(text.charAt(index - 1))) {
				score *= SCORE_SPACE_WORD_JUMP;
				const spaces = text.slice(textIndex, index - 1).match(COUNT_SPACES);
				if (spaces && textIndex > 0) score *= PENALTY_SKIPPED ** spaces.length;
			} else {
				score *= SCORE_CHARACTER_JUMP;
				if (textIndex > 0) score *= PENALTY_SKIPPED ** (index - textIndex);
			}
			if (text.charAt(index) !== query.charAt(queryIndex)) score *= PENALTY_CASE_MISMATCH;
		}
		if (
			(score < SCORE_TRANSPOSITION &&
				lowerText.charAt(index - 1) === lowerQuery.charAt(queryIndex + 1)) ||
			(lowerQuery.charAt(queryIndex + 1) === lowerQuery.charAt(queryIndex) &&
				lowerText.charAt(index - 1) !== lowerQuery.charAt(queryIndex))
		) {
			const transposed = scoreFrom(
				text,
				query,
				lowerText,
				lowerQuery,
				index + 1,
				queryIndex + 2,
				memo,
			);
			if (transposed * SCORE_TRANSPOSITION > score) score = transposed * SCORE_TRANSPOSITION;
		}
		if (score > best) best = score;
		index = lowerText.indexOf(queryChar, index + 1);
	}
	memo.set(memoKey, best);
	return best;
}

function normalize(text: string): string {
	return text.toLowerCase().replace(COUNT_SPACES, " ");
}

export function searchScore(value: string, search: string, keywords?: readonly string[]): number {
	const text = keywords && keywords.length > 0 ? `${value} ${keywords.join(" ")}` : value;
	return scoreFrom(text, search, normalize(text), normalize(search), 0, 0, new Map());
}

export interface SearchRow {
	value: string;
	keywords: readonly string[];
}

export function rowValue(section: string, model: ModelRef): string {
	return `${section}:${modelKey(model)}`;
}

const GROUP_ROW_PREFIX = "group:";

export function groupRowValue(provider: string): string {
	return `${GROUP_ROW_PREFIX}${provider}`;
}

export interface GroupExpansion {
	expanded: ReadonlySet<string>;
	collapsedWhileSearching: ReadonlySet<string>;
}

export function initialGroupExpansion(
	selected: ModelRef | null,
	pinned: readonly ModelRef[],
): GroupExpansion {
	const expanded =
		selected && !pinned.some((model) => sameModel(model, selected))
			? new Set([selected.provider])
			: new Set<string>();
	return { expanded, collapsedWhileSearching: new Set() };
}

function flip(set: ReadonlySet<string>, provider: string): Set<string> {
	const next = new Set(set);
	if (next.has(provider)) next.delete(provider);
	else next.add(provider);
	return next;
}

export function toggleGroup(
	state: GroupExpansion,
	provider: string,
	searching: boolean,
): GroupExpansion {
	return searching
		? { ...state, collapsedWhileSearching: flip(state.collapsedWhileSearching, provider) }
		: { ...state, expanded: flip(state.expanded, provider) };
}

export interface PickerGroup extends ProviderGroup {
	count: number;
	expanded: boolean;
}

function matches(row: SearchRow, query: string): boolean {
	return searchScore(row.value, query, row.keywords) > 0;
}

export function pickerGroups(
	t: Translator,
	models: readonly WireModel[],
	options: {
		pinned: readonly ModelRef[];
		query: string;
		expansion: GroupExpansion;
		row: (model: WireModel) => SearchRow;
	},
): PickerGroup[] {
	const { pinned, query, expansion, row } = options;
	const searching = query !== "";
	const unpinned = models.filter((model) => !pinned.some((p) => sameModel(p, model)));
	return groupByProvider(t, unpinned).flatMap((group) => {
		const count = searching
			? group.models.filter((model) => matches(row(model), query)).length
			: group.models.length;
		if (count === 0) return [];
		const expanded = searching
			? !expansion.collapsedWhileSearching.has(group.provider)
			: expansion.expanded.has(group.provider);
		return [{ ...group, count, expanded }];
	});
}

export function pickerFilter(
	groups: readonly ProviderGroup[],
	row: (model: WireModel) => SearchRow,
): (value: string, search: string, keywords?: string[]) => number {
	return (value, search, keywords) => {
		if (!value.startsWith(GROUP_ROW_PREFIX)) return searchScore(value, search, keywords);
		const group = groups.find((candidate) => groupRowValue(candidate.provider) === value);
		if (!group) return 0;
		const best = Math.max(
			0,
			...group.models.map((model) => {
				const { value: modelValue, keywords: modelKeywords } = row(model);
				return searchScore(modelValue, search, modelKeywords);
			}),
		);
		return best > 0 ? best + 1 : 0;
	};
}

export const PROVIDER_GROUP =
	"not-first:mt-4 not-first:border-border-muted not-first:border-t not-first:pt-4";

export const GROUPED_ROW = "ml-24";

export const NO_MODELS_HINT = "chat.modelPicker.noModelsHint" satisfies MessageKey;

export type PickerEmptyState = "no-match" | "no-models" | null;

export function pickerEmptyState(query: string, modelCount: number): PickerEmptyState {
	if (query !== "") return "no-match";
	return modelCount === 0 ? "no-models" : null;
}
