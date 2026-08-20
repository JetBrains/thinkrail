import {
	FIELDS,
	type Frontmatter,
	LIST_LINK_FIELDS,
	type LinkKind,
	list,
	SINGLE_LINK_FIELDS,
	scalar,
} from "./parse.ts";

export const LINK_KINDS = [...SINGLE_LINK_FIELDS, ...LIST_LINK_FIELDS] as const;

export interface SpecNode {
	id: string;
	type: string;
	title: string | undefined;
	path: string;
	frontmatter: Frontmatter;
}

export interface SpecEdge {
	from: string;
	to: string;
	kind: LinkKind;
}

export interface SpecFileEntry {
	path: string;
	frontmatter: Frontmatter;
}

export interface SpecGraph {
	nodes: Map<string, SpecNode>;
	edges: SpecEdge[];
	forward: Record<LinkKind, Map<string, string[]>>;
	reverse: Record<LinkKind, Map<string, string[]>>;
	duplicateIds: Map<string, string[]>;
}

function emptyAdjacency(): Record<LinkKind, Map<string, string[]>> {
	return Object.fromEntries(
		LINK_KINDS.map((kind) => [kind, new Map<string, string[]>()]),
	) as Record<LinkKind, Map<string, string[]>>;
}

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
