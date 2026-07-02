// Content grep with metadata filters, and bounded graph slices. Pi-free.

import type { SpecEdge, SpecGraph, SpecNode } from "./graph.ts";
import { FIELDS, type Frontmatter, type LinkKind, list, scalar } from "./parse.ts";

// ---------------------------------------------------------------------------
// grep
// ---------------------------------------------------------------------------

/** A spec file plus its text, the unit {@link grepSpecs} searches. */
export interface SpecContentEntry {
	path: string;
	content: string;
	frontmatter: Frontmatter;
}

/** Metadata narrowing applied before the text search. Every provided filter must match (AND). */
export interface SpecFilters {
	type?: string;
	tag?: string;
	parent?: string;
	dependsOn?: string;
}

/** Search options for {@link grepSpecs}. */
export interface GrepOptions extends SpecFilters {
	/** The pattern. Treated as a regex when `regex` is true, else a literal substring. */
	pattern: string;
	regex?: boolean;
	/** Case-insensitive match. Default true. */
	ignoreCase?: boolean;
	/** Cap on total matches returned. Default 200. */
	limit?: number;
}

/** One match: where it is and the matching line, trimmed. */
export interface GrepMatch {
	path: string;
	line: number;
	snippet: string;
}

/** The result of {@link grepSpecs}: the (capped) matches and whether the cap cut results short. */
export interface GrepResult {
	matches: GrepMatch[];
	/** True only when a further match existed beyond `limit` — not merely when exactly `limit` matched. */
	truncated: boolean;
}

function matchesFilters(fm: Frontmatter, filters: SpecFilters): boolean {
	if (filters.type !== undefined && scalar(fm, FIELDS.type) !== filters.type) return false;
	if (filters.parent !== undefined && scalar(fm, FIELDS.parent) !== filters.parent) return false;
	if (filters.tag !== undefined && !list(fm, FIELDS.tags).includes(filters.tag)) return false;
	if (filters.dependsOn !== undefined && !list(fm, FIELDS.dependsOn).includes(filters.dependsOn)) {
		return false;
	}
	return true;
}

/** Build a matcher predicate for a line from the grep options. Throws on an invalid regex. */
function buildMatcher(opts: GrepOptions): (line: string) => boolean {
	const ignoreCase = opts.ignoreCase ?? true;
	if (opts.regex) {
		const re = new RegExp(opts.pattern, ignoreCase ? "i" : "");
		return (line) => re.test(line);
	}
	if (ignoreCase) {
		const needle = opts.pattern.toLowerCase();
		return (line) => line.toLowerCase().includes(needle);
	}
	return (line) => line.includes(opts.pattern);
}

/**
 * Regex/substring search within a spec set, optionally narrowed by metadata filters. Returns
 * `path:line` matches with the matching line as a trimmed snippet.
 */
export function grepSpecs(entries: SpecContentEntry[], opts: GrepOptions): GrepResult {
	const limit = opts.limit ?? 200;
	const matcher = buildMatcher(opts);
	const matches: GrepMatch[] = [];
	for (const entry of entries) {
		if (!matchesFilters(entry.frontmatter, opts)) continue;
		const lines = entry.content.split("\n");
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i] ?? "";
			if (matcher(line)) {
				// One match past the cap means results were genuinely cut short.
				if (matches.length >= limit) return { matches, truncated: true };
				matches.push({ path: entry.path, line: i + 1, snippet: line.trim() });
			}
		}
	}
	return { matches, truncated: false };
}

// ---------------------------------------------------------------------------
// graph slices
// ---------------------------------------------------------------------------

/**
 * The directions {@link graphSlice} can walk from the root. A literal tuple so the tools layer derives
 * its `StringEnum` schema from it — one source of truth for the direction vocabulary.
 */
export const SLICE_DIRECTIONS = ["subtree", "ancestors", "neighbors"] as const;

/** Which way to walk from the slice root. */
export type SliceDirection = (typeof SLICE_DIRECTIONS)[number];

/** Options for {@link graphSlice}. */
export interface SliceOptions {
	root: string;
	depth?: number;
	direction: SliceDirection;
	/** For `neighbors`: which edge kind to traverse (and its reverse). Default `depends-on`. */
	edge?: LinkKind;
}

/** A bounded region of the graph: the reachable nodes and the edges among them. */
export interface GraphSlice {
	root: string;
	direction: SliceDirection;
	nodes: SpecNode[];
	edges: SpecEdge[];
	/** Ids referenced by the slice that have no node (dangling targets). */
	missing: string[];
}

/**
 * A bounded slice of the graph rooted at `root`:
 * - `subtree`: down the parent tree (children reachable within `depth`).
 * - `ancestors`: up the parent chain toward the tree root.
 * - `neighbors`: across a chosen edge and its reverse, out to `depth`.
 */
export function graphSlice(graph: SpecGraph, opts: SliceOptions): GraphSlice {
	const depth = opts.depth ?? 1;
	const included = new Set<string>([opts.root]);
	const edges: SpecEdge[] = [];
	const seenEdges = new Set<string>();
	const missing = new Set<string>();

	/** Follow `next(id)` breadth-first from the root out to `depth`, recording each edge once. */
	const walk = (next: (id: string) => { to: string; edge: SpecEdge }[]): void => {
		let frontier = [opts.root];
		for (let d = 0; d < depth; d++) {
			const nextFrontier: string[] = [];
			for (const id of frontier) {
				for (const { to, edge } of next(id)) {
					const key = `${edge.from}\u0000${edge.kind}\u0000${edge.to}`;
					if (!seenEdges.has(key)) {
						seenEdges.add(key);
						edges.push(edge);
					}
					if (!graph.nodes.has(to)) missing.add(to);
					if (!included.has(to)) {
						included.add(to);
						nextFrontier.push(to);
					}
				}
			}
			if (nextFrontier.length === 0) break;
			frontier = nextFrontier;
		}
	};

	if (opts.direction === "subtree") {
		// Children = reverse of the parent edge (X has parent root => X is a child of root).
		walk((id) =>
			(graph.reverse.parent.get(id) ?? []).map((child) => ({
				to: child,
				edge: { from: child, to: id, kind: FIELDS.parent },
			})),
		);
	} else if (opts.direction === "ancestors") {
		walk((id) =>
			(graph.forward.parent.get(id) ?? []).map((parent) => ({
				to: parent,
				edge: { from: id, to: parent, kind: FIELDS.parent },
			})),
		);
	} else {
		const edge = opts.edge ?? FIELDS.dependsOn;
		walk((id) => {
			const out = (graph.forward[edge].get(id) ?? []).map((to) => ({
				to,
				edge: { from: id, to, kind: edge } as SpecEdge,
			}));
			const inc = (graph.reverse[edge].get(id) ?? []).map((from) => ({
				to: from,
				edge: { from, to: id, kind: edge } as SpecEdge,
			}));
			return [...out, ...inc];
		});
	}

	const nodes: SpecNode[] = [];
	for (const id of included) {
		const node = graph.nodes.get(id);
		if (node) nodes.push(node);
	}
	return { root: opts.root, direction: opts.direction, nodes, edges, missing: [...missing] };
}
