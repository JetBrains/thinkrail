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

/** One reused index per project root, for the project-level `hasSpecs` check below (revalidate-on-read). */
const projectIndexes = new Map<string, SpecIndex>();

/**
 * Whether a project's repo root carries **any** registered spec (a file with `id` + `type` frontmatter,
 * anywhere under the root) — the signal the Welcome screen uses for its "Set up project" suggestion.
 * Uses the same derived, revalidate-on-read index as the agent's spec tools, so it's robust to any spec
 * filename/casing (not just a lowercased `goal-and-requirements.md`) and always reflects the filesystem.
 * A per-root index is reused so repeat reads (welcome, project.list) only pay the glob once. Defensive:
 * a globbing/parse failure degrades to `false` rather than breaking project open/list.
 */
export function projectHasSpecs(root: string): boolean {
	let index = projectIndexes.get(root);
	if (!index) {
		index = new SpecIndex(root);
		projectIndexes.set(root, index);
	}
	try {
		return index.graph().nodes.size > 0;
	} catch {
		return false;
	}
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
