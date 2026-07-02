// Structural checks over the graph: dangling links, duplicate ids, parent cycles. Pi-free.

import { LINK_KINDS, linkTargets, type SpecGraph } from "./graph.ts";
import { FIELDS, type LinkKind, scalar } from "./parse.ts";

/** A link whose target id has no node. */
export interface DanglingLink {
	from: string;
	fromPath: string;
	kind: LinkKind;
	target: string;
}

/** An id declared by more than one file. */
export interface DuplicateId {
	id: string;
	paths: string[];
}

/** A cycle in the parent tree, as the id chain that closes on itself. */
export interface ParentCycle {
	ids: string[];
}

/** The full validation report. Empty arrays mean a clean graph. */
export interface ValidationReport {
	danglingLinks: DanglingLink[];
	duplicateIds: DuplicateId[];
	parentCycles: ParentCycle[];
}

/** Detect all parent-chain cycles, returning each as a normalized id ring. */
function findParentCycles(graph: SpecGraph): ParentCycle[] {
	const cycles: ParentCycle[] = [];
	const seen = new Set<string>();

	for (const startId of graph.nodes.keys()) {
		if (seen.has(startId)) continue;
		const path: string[] = [];
		const onPath = new Map<string, number>();
		let current: string | undefined = startId;

		while (current !== undefined && graph.nodes.has(current)) {
			if (onPath.has(current)) {
				const ring = path.slice(onPath.get(current));
				const key = [...ring].sort().join("\u0000");
				if (!cycles.some((c) => [...c.ids].sort().join("\u0000") === key)) {
					cycles.push({ ids: ring });
				}
				break;
			}
			if (seen.has(current)) break;
			onPath.set(current, path.length);
			path.push(current);
			const node = graph.nodes.get(current);
			current = node ? scalar(node.frontmatter, FIELDS.parent) : undefined;
		}
		for (const id of path) seen.add(id);
	}
	return cycles;
}

/** Report dangling links, duplicate ids, and parent cycles for the given graph. */
export function validateGraph(graph: SpecGraph): ValidationReport {
	const danglingLinks: DanglingLink[] = [];
	for (const node of graph.nodes.values()) {
		for (const kind of LINK_KINDS) {
			for (const target of linkTargets(node.frontmatter, kind)) {
				if (!graph.nodes.has(target)) {
					danglingLinks.push({ from: node.id, fromPath: node.path, kind, target });
				}
			}
		}
	}

	const duplicateIds: DuplicateId[] = [...graph.duplicateIds].map(([id, paths]) => ({ id, paths }));

	return { danglingLinks, duplicateIds, parentCycles: findParentCycles(graph) };
}

/** True when the report has no findings. */
export function isValid(report: ValidationReport): boolean {
	return (
		report.danglingLinks.length === 0 &&
		report.duplicateIds.length === 0 &&
		report.parentCycles.length === 0
	);
}
