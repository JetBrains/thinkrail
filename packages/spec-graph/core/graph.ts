// files -> nodes + edges: the parent tree, the depends-on/references/implements DAG, and reverse edges.
// Pi-free.

import {
	FIELDS,
	type Frontmatter,
	LIST_LINK_FIELDS,
	type LinkKind,
	list,
	SINGLE_LINK_FIELDS,
	scalar,
} from "./parse.ts";

/**
 * The directed edge kinds the graph tracks (single-valued parent edge first, then the DAG links). A
 * literal tuple (not a widened `LinkKind[]`) so the tools layer can derive its `StringEnum` schema from
 * it — one source of truth for the edge vocabulary.
 */
export const LINK_KINDS = [...SINGLE_LINK_FIELDS, ...LIST_LINK_FIELDS] as const;

/** A spec node: identity + metadata + where it lives, keyed by `id`. */
export interface SpecNode {
	id: string;
	type: string;
	title: string | undefined;
	/** Path relative to the spec root. */
	path: string;
	frontmatter: Frontmatter;
}

/** A directed edge `from -> to` of a given kind. */
export interface SpecEdge {
	from: string;
	to: string;
	kind: LinkKind;
}

/** A file handed to {@link buildGraph}: its root-relative path and parsed frontmatter. */
export interface SpecFileEntry {
	path: string;
	frontmatter: Frontmatter;
}

/** The derived graph: nodes by id, forward/reverse adjacency per edge kind, and duplicate-id tracking. */
export interface SpecGraph {
	/** id -> node. On a duplicate id, the first file seen wins the node slot. */
	nodes: Map<string, SpecNode>;
	/** All edges, in discovery order. */
	edges: SpecEdge[];
	/** kind -> (from id -> target ids). */
	forward: Record<LinkKind, Map<string, string[]>>;
	/** kind -> (to id -> source ids). */
	reverse: Record<LinkKind, Map<string, string[]>>;
	/** id -> every path that declared it, only for ids declared more than once. */
	duplicateIds: Map<string, string[]>;
}

function emptyAdjacency(): Record<LinkKind, Map<string, string[]>> {
	// Derived from LINK_KINDS so a renamed/added edge kind needs no change here.
	return Object.fromEntries(
		LINK_KINDS.map((kind) => [kind, new Map<string, string[]>()]),
	) as Record<LinkKind, Map<string, string[]>>;
}

/** The declared targets of a node for a given edge kind (single-link kinds carry at most one). */
export function linkTargets(fm: Frontmatter, kind: LinkKind): string[] {
	if ((SINGLE_LINK_FIELDS as readonly string[]).includes(kind)) {
		const target = scalar(fm, kind);
		return target ? [target] : [];
	}
	return list(fm, kind);
}

function push(map: Map<string, string[]>, key: string, value: string): void {
	const existing = map.get(key);
	if (existing) existing.push(value);
	else map.set(key, [value]);
}

/** Build the derived graph from a set of spec files. Pure: same input -> same output. */
export function buildGraph(entries: SpecFileEntry[]): SpecGraph {
	const nodes = new Map<string, SpecNode>();
	const pathsById = new Map<string, string[]>();

	for (const entry of entries) {
		const id = scalar(entry.frontmatter, FIELDS.id);
		const type = scalar(entry.frontmatter, FIELDS.type);
		if (id === undefined || type === undefined) continue;
		push(pathsById, id, entry.path);
		if (!nodes.has(id)) {
			nodes.set(id, {
				id,
				type,
				title: scalar(entry.frontmatter, FIELDS.title),
				path: entry.path,
				frontmatter: entry.frontmatter,
			});
		}
	}

	const forward = emptyAdjacency();
	const reverse = emptyAdjacency();
	const edges: SpecEdge[] = [];

	for (const node of nodes.values()) {
		for (const kind of LINK_KINDS) {
			for (const to of linkTargets(node.frontmatter, kind)) {
				edges.push({ from: node.id, to, kind });
				push(forward[kind], node.id, to);
				push(reverse[kind], to, node.id);
			}
		}
	}

	const duplicateIds = new Map<string, string[]>();
	for (const [id, paths] of pathsById) {
		if (paths.length > 1) duplicateIds.set(id, paths);
	}

	return { nodes, edges, forward, reverse, duplicateIds };
}
