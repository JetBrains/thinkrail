const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;
const EMBEDDED_MAX_CHARS = 300_000;

/** `a.b[2]["odd key"]`: the path a key or index adds to its parent's. */
export function childPath(parent: string, key: string | number): string {
	if (typeof key === "number") return `${parent}[${key}]`;
	if (IDENTIFIER.test(key)) return parent ? `${parent}.${key}` : key;
	return `${parent}[${JSON.stringify(key)}]`;
}

/** The core's spelling of the same path (`a.b[2].odd key`), which its cut list uses; `$` is the root. */
export function cutPath(parent: string, key: string | number): string {
	if (typeof key === "number") return `${parent}[${key}]`;
	return parent ? `${parent}.${key}` : key;
}

export function cutIndex(
	cuts: readonly (readonly [string, number])[],
): ReadonlyMap<string, number> {
	return new Map(cuts.map(([path, size]) => [path === "$" ? "" : path, size]));
}

/** A string holding a JSON object or array, parsed; anything else `undefined`. */
export function parseEmbedded(value: string): unknown {
	const trimmed = value.trim();
	if (trimmed.length < 2 || trimmed.length > EMBEDDED_MAX_CHARS || !/^[[{]/.test(trimmed))
		return undefined;
	try {
		const parsed: unknown = JSON.parse(trimmed);
		return typeof parsed === "object" && parsed !== null ? parsed : undefined;
	} catch {
		return undefined;
	}
}

function occurrences(text: string, needle: string): number {
	if (!needle) return 0;
	let count = 0;
	for (let at = text.indexOf(needle); at >= 0; at = text.indexOf(needle, at + needle.length))
		count += 1;
	return count;
}

/** Matches of `query` (case-insensitive) in keys and scalar values. */
export function countMatches(value: unknown, query: string): number {
	const needle = query.toLowerCase();
	if (!needle) return 0;
	if (value === null || typeof value !== "object")
		return occurrences(String(value).toLowerCase(), needle);
	let count = 0;
	for (const [key, item] of Object.entries(value)) {
		if (!Array.isArray(value)) count += occurrences(key.toLowerCase(), needle);
		count += countMatches(item, query);
	}
	return count;
}

export function containsQuery(value: unknown, query: string): boolean {
	return query.length > 0 && countMatches(value, query) > 0;
}

export interface Highlight {
	text: string;
	match: boolean;
	/** Where the part starts in the text; a stable key. */
	at: number;
}

/** `text` split around case-insensitive matches of `query`. */
export function highlightParts(text: string, query: string): Highlight[] {
	if (!query) return [{ text, match: false, at: 0 }];
	const lower = text.toLowerCase();
	const needle = query.toLowerCase();
	const parts: Highlight[] = [];
	let from = 0;
	for (let at = lower.indexOf(needle); at >= 0; at = lower.indexOf(needle, at + needle.length)) {
		if (at > from) parts.push({ text: text.slice(from, at), match: false, at: from });
		parts.push({ text: text.slice(at, at + needle.length), match: true, at });
		from = at + needle.length;
	}
	if (from < text.length) parts.push({ text: text.slice(from), match: false, at: from });
	return parts;
}
