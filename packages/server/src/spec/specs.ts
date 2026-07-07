// The Specs-viewer read: a whole-graph snapshot of a worktree's spec-graph, mapped to the wire DTOs.
// Reads through pi-spec-graph's derived index (revalidate-on-read), so every fetch sees the current
// filesystem; one SpecIndex is reused per worktree root so the parse cache pays off across fetches.

import type { SpecGraphNode, SpecGraphSnapshot } from "@thinkrail/contracts";
import { FIELDS, list, SpecIndex, scalar } from "pi-spec-graph/core";
import { loadWorkspaces } from "../persistence";

/** One reused index per workspace (1:1 with its worktree root; same pattern as the agent's spec tools). */
const indexes = new Map<string, SpecIndex>();

function indexFor(workspaceId: string, root: string): SpecIndex {
	let index = indexes.get(workspaceId);
	if (!index) {
		index = new SpecIndex(root);
		indexes.set(workspaceId, index);
	}
	return index;
}

/** Drop a workspace's cached index (called by `host` on workspace removal); a later read rebuilds it. */
export function evictSpecIndex(workspaceId: string): void {
	indexes.delete(workspaceId);
}

/** The workspace worktree's spec-graph as a flat node snapshot; the client derives the tree. */
export function specGraph(workspaceId: string): SpecGraphSnapshot {
	const ws = loadWorkspaces().find((w) => w.id === workspaceId);
	if (!ws) throw new Error(`Unknown workspace: ${workspaceId}`);

	const graph = indexFor(ws.id, ws.worktreePath).graph();
	const nodes: SpecGraphNode[] = [...graph.nodes.values()].map((node) => {
		const status = scalar(node.frontmatter, FIELDS.status);
		const parent = scalar(node.frontmatter, FIELDS.parent);
		return {
			id: node.id,
			type: node.type,
			title: node.title ?? node.id,
			...(status !== undefined ? { status } : {}),
			path: node.path,
			...(parent !== undefined ? { parent } : {}),
			dependsOn: list(node.frontmatter, FIELDS.dependsOn),
			references: list(node.frontmatter, FIELDS.references),
			implements: list(node.frontmatter, FIELDS.implements),
			tags: list(node.frontmatter, FIELDS.tags),
		};
	});
	return { nodes };
}
