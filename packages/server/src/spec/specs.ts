// The Specs-viewer read: a whole-graph snapshot of a worktree's spec-graph, mapped to the wire DTOs.
// Reads through pi-spec-graph's derived index (revalidate-on-read), so every fetch sees the current
// filesystem; one SpecIndex is reused per worktree root so the parse cache pays off across fetches.

import { mkdirSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import type { SpecGraphNode, SpecGraphSnapshot, SpecTypeInfo } from "@thinkrail/contracts";
import {
	FIELDS,
	list,
	parseTypeCard,
	SpecIndex,
	SpecTypeRegistry,
	scalar,
} from "pi-spec-graph/core";
import { loadWorkspaces } from "../persistence";

/** One reused index per workspace (1:1 with its worktree root; same pattern as the agent's spec tools). */
const indexes = new Map<string, SpecIndex>();
/** One reused type-card registry per workspace (freshness handled inside, like the index). */
const registries = new Map<string, SpecTypeRegistry>();

function indexFor(workspaceId: string, root: string): SpecIndex {
	let index = indexes.get(workspaceId);
	if (!index) {
		index = new SpecIndex(root);
		indexes.set(workspaceId, index);
	}
	return index;
}

function registryFor(workspaceId: string, root: string): SpecTypeRegistry {
	let registry = registries.get(workspaceId);
	if (!registry) {
		registry = new SpecTypeRegistry(root);
		registries.set(workspaceId, registry);
	}
	return registry;
}

/** Drop a workspace's cached index + registry (called by `host` on workspace removal); a later read rebuilds them. */
export function evictSpecIndex(workspaceId: string): void {
	indexes.delete(workspaceId);
	registries.delete(workspaceId);
}

/** One reused index + registry per project root, for the project-level `hasSpecs` check below. */
const projectIndexes = new Map<string, SpecIndex>();
const projectRegistries = new Map<string, SpecTypeRegistry>();

/**
 * Whether a project's repo root carries any **durable** spec — a file with `id` + `type` frontmatter,
 * anywhere under the root, whose type's card resolves to `lifecycle: durable` — the signal the Welcome
 * screen uses for its "Set up project" suggestion. Ephemeral specs (`task-spec`s and any custom
 * ephemeral type; temp docs, e.g. in `.thinkrail/context/`) never count: a scratch design doc must not
 * make a project look already set up. Unknown types count as durable (the registry's safe default).
 * Uses the same derived, revalidate-on-read index as the agent's spec tools, so it's robust to any spec
 * filename/casing (not just a lowercased `goal-and-requirements.md`) and always reflects the filesystem.
 * A per-root index is reused across reads (welcome, project.list) so its parse cache skips re-reading
 * unchanged spec files — only new or changed ones are re-parsed. Defensive: a globbing/parse failure
 * degrades to `false` rather than breaking project open/list.
 */
export function projectHasSpecs(root: string): boolean {
	let index = projectIndexes.get(root);
	if (!index) {
		index = new SpecIndex(root);
		projectIndexes.set(root, index);
	}
	let registry = projectRegistries.get(root);
	if (!registry) {
		registry = new SpecTypeRegistry(root);
		projectRegistries.set(root, registry);
	}
	try {
		for (const node of index.graph().nodes.values()) {
			if (registry.lifecycleOf(node.type) === "durable") return true;
		}
		return false;
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
	const types: SpecTypeInfo[] = registryFor(ws.id, ws.worktreePath)
		.cards()
		.map((card) => {
			const rel =
				card.path !== undefined ? relative(ws.worktreePath, card.path).split(sep).join("/") : null;
			return {
				name: card.name,
				title: card.title,
				description: card.description,
				lifecycle: card.lifecycle,
				origin: card.origin,
				sections: card.sections,
				...(rel !== null && !rel.startsWith("..") ? { path: rel } : {}),
			};
		});
	return { nodes, types };
}

/** A card name must be a slug: it doubles as the filename and the `type` value specs carry. */
const CARD_NAME = /^[a-z0-9][a-z0-9-]*$/;

/**
 * Save (create or overwrite) one **project** spec-type card as `.pi/spec-types/<name>.md` — the type
 * constructor's write path. Deliberately scoped, not a general file write: the name must be a slug (it
 * is the filename — no traversal), the content must parse as a type card whose `name` matches, and the
 * write lands only inside the worktree's `.pi/spec-types/`. The next `spec.graph` read picks it up
 * (revalidate-on-read); no cache to invalidate here.
 */
export function saveTypeCard(workspaceId: string, name: string, content: string): { path: string } {
	const ws = loadWorkspaces().find((w) => w.id === workspaceId);
	if (!ws) throw new Error(`Unknown workspace: ${workspaceId}`);
	if (!CARD_NAME.test(name)) {
		throw new Error(`Invalid type name "${name}" — use a lowercase slug (a-z, 0-9, hyphens).`);
	}
	const card = parseTypeCard(content);
	if (card === null) {
		throw new Error("Content is not a valid type card (frontmatter needs name + description).");
	}
	if (card.name !== name) {
		throw new Error(`Card frontmatter name "${card.name}" must match the type name "${name}".`);
	}
	const dir = join(ws.worktreePath, ".pi", "spec-types");
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, `${name}.md`), content, "utf8");
	return { path: `.pi/spec-types/${name}.md` };
}
