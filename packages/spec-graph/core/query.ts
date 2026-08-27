import type { SpecEdge, SpecGraph, SpecNode } from "./graph.ts";
import { FIELDS, type Frontmatter, type LinkKind, list, scalar } from "./parse.ts";

export interface SpecContentEntry {
	path: string;
	content: string;
	frontmatter: Frontmatter;
}

export interface SpecFilters {
	type?: string;
	tag?: string;
	parent?: string;
	dependsOn?: string;
}

export interface GrepOptions extends SpecFilters {
	pattern: string;
	regex?: boolean;
	ignoreCase?: boolean;
	limit?: number;
}

export interface GrepMatch {
	path: string;
	line: number;
	snippet: string;
}

export interface GrepResult {
	matches: GrepMatch[];
	truncated: boolean;
}

export const DEFAULT_GREP_LIMIT = 200;

function matchesFilters(fm: Frontmatter, filters: SpecFilters): boolean {
	if (filters.type !== undefined && scalar(fm, FIELDS.type) !== filters.type) return false;
	if (filters.parent !== undefined && scalar(fm, FIELDS.parent) !== filters.parent) return false;
	if (filters.tag !== undefined && !list(fm, FIELDS.tags).includes(filters.tag)) return false;
	if (filters.dependsOn !== undefined && !list(fm, FIELDS.dependsOn).includes(filters.dependsOn)) {
		return false;
	}
	return true;
}

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

export function grepSpecs(entries: SpecContentEntry[], opts: GrepOptions): GrepResult {
	const requested = Math.trunc(opts.limit ?? DEFAULT_GREP_LIMIT);
	const limit = requested > 0 ? requested : DEFAULT_GREP_LIMIT;
	const matcher = buildMatcher(opts);
	const matches: GrepMatch[] = [];
	for (const entry of entries) {
		if (!matchesFilters(entry.frontmatter, opts)) continue;
		const lines = entry.content.split("\n");
		for (let i = 0; i < lines.length; i++) {
			const raw = (i === 0 ? (lines[0]?.replace(/^\ufeff/, "") ?? "") : (lines[i] ?? "")) as string;
			const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
			if (matcher(line)) {
				if (matches.length >= limit) return { matches, truncated: true };
				matches.push({ path: entry.path, line: i + 1, snippet: line.trim() });
			}
		}
	}
	return { matches, truncated: false };
}

export const SLICE_DIRECTIONS = ["subtree", "ancestors", "neighbors"] as const;

export type SliceDirection = (typeof SLICE_DIRECTIONS)[number];

export interface SliceOptions {
	root: string;
	depth?: number;
	direction: SliceDirection;
	edge?: LinkKind;
}

export interface GraphSlice {
	root: string;
	direction: SliceDirection;
	nodes: SpecNode[];
	edges: SpecEdge[];
	missing: string[];
}

export function graphSlice(graph: SpecGraph, opts: SliceOptions): GraphSlice {
	const depth = opts.depth ?? 1;
	const included = new Set<string>([opts.root]);
	const edges: SpecEdge[] = [];
	const seenEdges = new Set<string>();
	const missing = new Set<string>();

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
