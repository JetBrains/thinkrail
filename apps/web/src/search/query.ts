import {
	MAX_SEARCH_QUERY_LENGTH,
	type MatchTerm,
	parseMatchTerms,
	SEARCH_KINDS,
	type SearchKind,
} from "@thinkrail/contracts";

export const SEARCH_SCOPES = ["all", "work", "files", "specs", "commands"] as const;
export type SearchScope = (typeof SEARCH_SCOPES)[number];

const SCOPE_KINDS: Record<SearchScope, readonly SearchKind[]> = {
	all: SEARCH_KINDS.filter((kind) => kind !== "section"),
	work: ["chat", "transcript", "workspace", "plan"],
	files: ["file"],
	specs: ["spec", "section"],
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

export interface ParsedQuery {
	readonly raw: string;
	readonly scope: SearchScope;
	readonly text: string;
	readonly terms: readonly MatchTerm[];
}

const PREFIX_SCOPE = new Map<string, Exclude<SearchScope, "all">>(
	Object.entries(SCOPE_PREFIX).map(([scope, prefix]) => [
		prefix,
		scope as Exclude<SearchScope, "all">,
	]),
);

const PULL_REQUEST_NUMBER = /^#\d+$/;

export function parseSearchQuery(raw: string): ParsedQuery {
	const trimmed = raw.trimStart();
	const prefixScope = PULL_REQUEST_NUMBER.test(trimmed.trim())
		? undefined
		: PREFIX_SCOPE.get(trimmed[0] ?? "");
	const text = (prefixScope ? trimmed.slice(1) : trimmed).trim().slice(0, MAX_SEARCH_QUERY_LENGTH);
	return { raw, scope: prefixScope ?? "all", text, terms: parseMatchTerms(text) };
}

export function withScopePrefix(text: string, scope: SearchScope): string {
	return scope === "all" ? text : `${SCOPE_PREFIX[scope]}${text}`;
}

export function stripScopePrefix(raw: string): string {
	const trimmed = raw.trimStart();
	if (PULL_REQUEST_NUMBER.test(trimmed.trim())) return raw;
	return PREFIX_SCOPE.has(trimmed[0] ?? "") ? trimmed.slice(1).trimStart() : raw;
}
