import { parseMatchTerms, SEARCH_KINDS, type SearchKind } from "@thinkrail/contracts";

export const SEARCH_SCOPES = ["all", "work", "files", "specs", "commands"] as const;
export type SearchScope = (typeof SEARCH_SCOPES)[number];

const SCOPE_KINDS: Record<SearchScope, readonly SearchKind[]> = {
	all: SEARCH_KINDS,
	work: ["chat", "transcript", "workspace", "plan"],
	files: ["file"],
	specs: ["spec"],
	commands: [],
};

export function scopeKinds(scope: SearchScope): readonly SearchKind[] {
	return SCOPE_KINDS[scope];
}

export const SCOPE_PREFIX: Record<Exclude<SearchScope, "all">, string> = {
	work: "@",
	files: "/",
	specs: "#",
	commands: ">",
};

export const STATE_FILTERS = [
	"is:waiting",
	"is:error",
	"is:unread",
	"is:running",
	"is:settled",
	"has:pr",
] as const;
export type StateFilter = (typeof STATE_FILTERS)[number];

export interface ParsedQuery {
	readonly raw: string;
	readonly scope: SearchScope;
	readonly text: string;
	readonly terms: readonly string[];
	readonly filters: readonly StateFilter[];
	readonly partialFilter: string | null;
	readonly prNumber: string | null;
}

const PREFIX_SCOPE = new Map<string, Exclude<SearchScope, "all">>(
	Object.entries(SCOPE_PREFIX).map(([scope, prefix]) => [
		prefix,
		scope as Exclude<SearchScope, "all">,
	]),
);

function isStateFilter(token: string): token is StateFilter {
	return (STATE_FILTERS as readonly string[]).includes(token);
}

export function parseSearchQuery(raw: string): ParsedQuery {
	const trimmed = raw.trimStart();
	const prNumber = /^#(\d+)$/.exec(trimmed.trim())?.[1] ?? null;
	const prefixScope = prNumber === null ? PREFIX_SCOPE.get(trimmed[0] ?? "") : undefined;
	const body = prefixScope ? trimmed.slice(1) : trimmed;
	const filters: StateFilter[] = [];
	let partialFilter: string | null = null;
	const textTokens: string[] = [];
	for (const match of body.matchAll(/"[^"]*"?|\S+/g)) {
		const token = match[0];
		const lower = token.toLowerCase();
		if (token.startsWith('"')) {
			textTokens.push(token);
		} else if (isStateFilter(lower)) {
			if (!filters.includes(lower)) filters.push(lower);
		} else if (/^(is|has):\w*$/.test(lower)) {
			partialFilter = lower;
		} else {
			textTokens.push(token);
		}
	}
	const text = textTokens.join(" ");
	return {
		raw,
		scope: prefixScope ?? "all",
		text,
		terms: parseMatchTerms(text),
		filters,
		partialFilter,
		prNumber,
	};
}

export function withScopePrefix(text: string, scope: SearchScope): string {
	return scope === "all" ? text : `${SCOPE_PREFIX[scope]}${text}`;
}

export function stripScopePrefix(raw: string): string {
	const trimmed = raw.trimStart();
	if (/^#\d+$/.test(trimmed.trim())) return raw;
	return PREFIX_SCOPE.has(trimmed[0] ?? "") ? trimmed.slice(1).trimStart() : raw;
}
