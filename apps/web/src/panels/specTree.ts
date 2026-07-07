// Pure tree-build for the Specs viewer: flat `spec.graph` snapshot -> the materialized `parent` tree.
// No React, no store, no transport — unit-testable on its own.

import type { SpecGraphNode } from "@thinkrail/contracts";

/** A materialized node of the `parent` tree: the spec plus its (title-sorted) children. */
export interface SpecTreeNode {
	node: SpecGraphNode;
	children: SpecTreeNode[];
}

/**
 * Materialize the `parent` tree from a flat snapshot: roots are nodes with no (or a dangling/self)
 * parent; roots and siblings sort by title. A well-formed graph is assumed — parent cycles are
 * `spec_validate`'s problem, not the viewer's (cycle members are unreachable from any root and simply
 * don't render) — but the walk is visited-guarded, so malformed input can never hang or loop the UI.
 */
export function buildSpecTree(nodes: SpecGraphNode[]): SpecTreeNode[] {
	const ids = new Set(nodes.map((n) => n.id));
	const roots: SpecGraphNode[] = [];
	const childrenByParent = new Map<string, SpecGraphNode[]>();
	const byTitle = (a: SpecGraphNode, b: SpecGraphNode) => a.title.localeCompare(b.title);

	for (const node of nodes) {
		if (node.parent !== undefined && ids.has(node.parent) && node.parent !== node.id) {
			const siblings = childrenByParent.get(node.parent);
			if (siblings) siblings.push(node);
			else childrenByParent.set(node.parent, [node]);
		} else {
			roots.push(node);
		}
	}
	roots.sort(byTitle);
	for (const children of childrenByParent.values()) children.sort(byTitle);

	const visited = new Set<string>();
	const materialize = (node: SpecGraphNode): SpecTreeNode => {
		visited.add(node.id);
		const children: SpecTreeNode[] = [];
		for (const child of childrenByParent.get(node.id) ?? []) {
			if (!visited.has(child.id)) children.push(materialize(child));
		}
		return { node, children };
	};
	return roots.map(materialize);
}
