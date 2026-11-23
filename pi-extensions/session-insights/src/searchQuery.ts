import {
	type ParsedSearch,
	SEARCH_FILTER_KEYS,
	SEARCH_RULES,
	type SearchFilter,
	type SearchFilterKey,
	type SearchSpan,
	type SearchTerm,
	type SessionsSearchParams,
} from "./core.ts";
import { parseSessionsListParams } from "./list.ts";
import { isRecord } from "./totals.ts";

const CLIENT_MAX = 100;
const CURSOR_MAX = 200;
const KEY = /^[A-Za-z]+$/;

function isFilterKey(key: string): key is SearchFilterKey {
	return (SEARCH_FILTER_KEYS as readonly string[]).includes(key);
}

function isSpace(char: string | undefined): boolean {
	return char === " " || char === "\t" || char === "\n" || char === "\r";
}

/** A quoted run from `at` (its opening `"`): the text with `\\"` and `\\\\` unescaped, and where it ends. */
function readQuoted(text: string, at: number): { value: string; end: number } {
	let value = "";
	let index = at + 1;
	while (index < text.length) {
		const char = text[index];
		if (char === "\\" && (text[index + 1] === '"' || text[index + 1] === "\\")) {
			value += text[index + 1];
			index += 2;
			continue;
		}
		if (char === '"') return { value, end: index + 1 };
		value += char;
		index += 1;
	}
	return { value, end: index };
}

function readBare(text: string, at: number): number {
	let index = at;
	while (index < text.length && !isSpace(text[index])) index += 1;
	return index;
}

/**
 * Reads a search query: words and `"quoted phrases"` are free-text terms; `key:value` (or
 * `key:"a value"`) is a filter when `key` is one of `SEARCH_FILTER_KEYS` (any case), otherwise the whole
 * token is a term and its key is reported as unknown. Deterministic and total: any text parses.
 */
export function parseSearchQuery(text: string): ParsedSearch {
	const terms: SearchTerm[] = [];
	const filters: SearchFilter[] = [];
	const unknown: { key: string; span: SearchSpan }[] = [];
	const ignored: SearchSpan[] = [];
	const addTerm = (value: string, quoted: boolean, span: SearchSpan) => {
		if (value.trim().length < SEARCH_RULES.termMin || terms.length >= SEARCH_RULES.maxTerms)
			ignored.push(span);
		else terms.push({ text: value, quoted, span });
	};
	let at = 0;
	while (at < text.length) {
		if (isSpace(text[at])) {
			at += 1;
			continue;
		}
		const start = at;
		if (text[at] === '"') {
			const quoted = readQuoted(text, at);
			addTerm(quoted.value, true, { start, end: quoted.end });
			at = quoted.end;
			continue;
		}
		const colon = text.indexOf(":", at);
		const bareEnd = readBare(text, at);
		const key = colon > at && colon < bareEnd ? text.slice(at, colon) : null;
		if (key === null || !KEY.test(key) || text.startsWith("//", colon + 1)) {
			addTerm(text.slice(start, bareEnd), false, { start, end: bareEnd });
			at = bareEnd;
			continue;
		}
		let value: string;
		let end: number;
		if (text[colon + 1] === '"') {
			const quoted = readQuoted(text, colon + 1);
			value = quoted.value;
			end = quoted.end;
		} else {
			end = bareEnd;
			value = text.slice(colon + 1, end);
		}
		const span = { start, end };
		const lower = key.toLowerCase();
		if (isFilterKey(lower)) {
			const trimmed = value.trim();
			if (trimmed) filters.push({ key: lower, value: trimmed, span });
			else ignored.push(span);
		} else {
			unknown.push({ key, span });
			addTerm(text.slice(start, end), false, span);
		}
		at = end;
	}
	return { terms, filters, unknown, ignored };
}

function invalid(): Error {
	return new Error("Invalid search params");
}

/** `{ scope, client, seq, query, facets?, cursor? }`; malformed params reject before the index is touched. */
export function parseSessionsSearchParams(value: unknown): SessionsSearchParams {
	if (!isRecord(value)) throw invalid();
	let scope: SessionsSearchParams["scope"];
	try {
		scope = parseSessionsListParams(value).scope;
	} catch {
		throw invalid();
	}
	const { client, seq, query, facets, cursor } = value;
	if (typeof client !== "string" || client.length === 0 || client.length > CLIENT_MAX)
		throw invalid();
	if (typeof seq !== "number" || !Number.isSafeInteger(seq) || seq < 0) throw invalid();
	if (typeof query !== "string" || query.length > SEARCH_RULES.queryChars) throw invalid();
	if (facets !== undefined && typeof facets !== "boolean") throw invalid();
	if (
		cursor !== undefined &&
		(typeof cursor !== "string" || cursor.length === 0 || cursor.length > CURSOR_MAX)
	)
		throw invalid();
	return {
		scope,
		client,
		seq,
		query,
		...(facets !== undefined ? { facets } : {}),
		...(cursor !== undefined ? { cursor } : {}),
	};
}
