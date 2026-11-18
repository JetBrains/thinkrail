import type {
	FacetCount,
	ParsedSearch,
	SearchFilter,
	SearchFilterKey,
	SearchSpan,
	SearchVocabulary,
} from "@thinkrail/pi-session-insights/core";

/** The filters offered in a scope; `project:` only across projects. */
export const FILTER_KEYS: readonly SearchFilterKey[] = [
	"tool",
	"error",
	"file",
	"skill",
	"model",
	"label",
];
export const ALL_FILTER_KEYS: readonly SearchFilterKey[] = [...FILTER_KEYS, "project"];

const SUGGESTIONS = 8;
const QUOTE_NEEDED = /[\s"]/;

/**
 * The token under the caret, for suggestions only: the server parses the query that is searched.
 * `key` is set for `key:` tokens of a known filter; `value` is what follows the colon (quotes dropped).
 */
export interface CaretToken {
	span: SearchSpan;
	text: string;
	key: SearchFilterKey | null;
	value: string;
}

function isKey(key: string, keys: readonly SearchFilterKey[]): key is SearchFilterKey {
	return (keys as readonly string[]).includes(key);
}

/** The whitespace-separated token around `caret`, a quoted value kept whole. */
export function tokenAt(
	text: string,
	caret: number,
	keys: readonly SearchFilterKey[] = ALL_FILTER_KEYS,
): CaretToken {
	let start = 0;
	let quoted = false;
	for (let at = 0; at < caret; at++) {
		const char = text[at];
		if (char === "\\" && quoted) {
			at += 1;
			continue;
		}
		if (char === '"') quoted = !quoted;
		else if (!quoted && (char === " " || char === "\t")) start = at + 1;
	}
	let end = caret;
	while (end < text.length) {
		const char = text[end];
		if (char === "\\" && quoted) {
			end += 2;
			continue;
		}
		if (char === '"') quoted = !quoted;
		else if (!quoted && (char === " " || char === "\t")) break;
		end += 1;
	}
	end = Math.min(end, text.length);
	const token = text.slice(start, end);
	const colon = token.indexOf(":");
	const key = colon > 0 ? token.slice(0, colon).toLowerCase() : "";
	if (colon > 0 && isKey(key, keys)) {
		const raw = token.slice(colon + 1);
		const value = raw.startsWith('"')
			? raw.slice(1).replace(/"$/, "").replace(/\\(.)/g, "$1")
			: raw;
		return { span: { start, end }, text: token, key, value };
	}
	return { span: { start, end }, text: token, key: null, value: "" };
}

/** `key:value`, quoted (with `"` and `\` escaped) when the value holds a space or a quote. */
export function filterText(key: SearchFilterKey, value: string): string {
	if (!QUOTE_NEEDED.test(value) && !value.includes("\\")) return `${key}:${value}`;
	return `${key}:"${value.replace(/[\\"]/g, "\\$&")}"`;
}

/** A filter as the query names a facet value: `""` (none) is `none`. */
export function facetFilterValue(value: string): string {
	return value === "" ? "none" : value;
}

/** Replaces `span` with `insert`, followed by one space; the caret goes after it. */
export function replaceSpan(
	text: string,
	span: SearchSpan,
	insert: string,
): { text: string; caret: number } {
	const before = text.slice(0, span.start);
	const after = text.slice(span.end).replace(/^\s*/, "");
	const next = `${before}${insert} ${after}`;
	return { text: next, caret: before.length + insert.length + 1 };
}

/** The query without the span (and the whitespace after it). */
export function removeSpan(text: string, span: SearchSpan): string {
	return `${text.slice(0, span.start)}${text.slice(span.end).replace(/^\s+/, "")}`.trimEnd();
}

/** The query without a filter the server read, unless the text moved on since (then unchanged). */
export function removeFilter(text: string, filter: SearchFilter): string {
	const token = text.slice(filter.span.start, filter.span.end).toLowerCase();
	return token.startsWith(`${filter.key}:`) ? removeSpan(text, filter.span) : text;
}

/** Whether the parsed query filters `key` by `value` (case-insensitive; `""` is `none`). */
export function hasFilter(
	parsed: ParsedSearch | null,
	key: SearchFilterKey,
	value: string,
): SearchSpan | null {
	const wanted = facetFilterValue(value).toLowerCase();
	return (
		parsed?.filters.find((filter) => filter.key === key && filter.value.toLowerCase() === wanted)
			?.span ?? null
	);
}

/** Adds `key:value` to the query, or removes it when the parsed query has it. */
export function toggleFilter(
	text: string,
	parsed: ParsedSearch | null,
	key: SearchFilterKey,
	value: string,
): string {
	const wanted = facetFilterValue(value).toLowerCase();
	const found = parsed?.filters.find(
		(filter) => filter.key === key && filter.value.toLowerCase() === wanted,
	);
	if (found) return removeFilter(text, found);
	const filter = filterText(key, facetFilterValue(value));
	const trimmed = text.trimEnd();
	return trimmed ? `${trimmed} ${filter}` : filter;
}

export type Suggestion =
	| { kind: "key"; key: SearchFilterKey }
	| { kind: "value"; key: SearchFilterKey; value: string; count: number | null };

function valuesOf(
	vocabulary: SearchVocabulary | null,
	key: SearchFilterKey,
): readonly FacetCount[] {
	if (!vocabulary) return [];
	if (key === "error")
		return [{ value: "yes", count: -1 }, { value: "no", count: -1 }, ...vocabulary.error];
	return vocabulary[key];
}

/**
 * What to offer for the caret's token: filter keys a bare word starts, or a filter's values from the
 * scope (the server's counts, in its order) that contain what is typed. Presentation only.
 */
export function suggestionsFor(
	token: CaretToken,
	vocabulary: SearchVocabulary | null,
	keys: readonly SearchFilterKey[],
): Suggestion[] {
	if (token.key) {
		const typed = token.value.toLowerCase();
		return valuesOf(vocabulary, token.key)
			.filter(
				(item) =>
					item.value !== "" &&
					item.value.toLowerCase().includes(typed) &&
					item.value.toLowerCase() !== typed,
			)
			.slice(0, SUGGESTIONS)
			.map((item) => ({
				kind: "value",
				key: token.key ?? "tool",
				value: item.value,
				count: item.count < 0 ? null : item.count,
			}));
	}
	const typed = token.text.toLowerCase();
	if (!typed || typed.includes(":") || typed.startsWith('"')) return [];
	return keys
		.filter((key) => key.startsWith(typed) && key !== typed)
		.map((key) => ({ kind: "key", key }));
}

/** The query with the caret token replaced by the suggestion; a key leaves the caret after its colon. */
export function applySuggestion(
	text: string,
	token: CaretToken,
	suggestion: Suggestion,
): { text: string; caret: number } {
	if (suggestion.kind === "key") {
		const insert = `${suggestion.key}:`;
		const before = text.slice(0, token.span.start);
		return {
			text: `${before}${insert}${text.slice(token.span.end)}`,
			caret: before.length + insert.length,
		};
	}
	return replaceSpan(text, token.span, filterText(suggestion.key, suggestion.value));
}
