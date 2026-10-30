import type { SpecGraphNode, SpecGraphSnapshot } from "@thinkrail/contracts";
import { FIELDS, list, SpecIndex, scalar } from "pi-spec-graph/core";
import { loadWorkspaces } from "../persistence";

const indexes = new Map<string, SpecIndex>();

function indexFor(workspaceId: string, root: string): SpecIndex {
	let index = indexes.get(workspaceId);
	if (!index) {
		index = new SpecIndex(root);
		indexes.set(workspaceId, index);
	}
	return index;
}

export function evictSpecIndex(workspaceId: string): void {
	indexes.delete(workspaceId);
}

const projectIndexes = new Map<string, SpecIndex>();

function rootIndexFor(root: string): SpecIndex {
	let index = projectIndexes.get(root);
	if (!index) {
		index = new SpecIndex(root);
		projectIndexes.set(root, index);
	}
	return index;
}

export interface SpecSnapshotEntry {
	readonly path: string;
	readonly id: string;
	readonly title: string;
	readonly type: string;
	readonly content: string;
}

const SNAPSHOT_TTL_MS = 60_000;
const SNAPSHOT_ROOTS = 8;
const snapshots = new Map<string, { at: number; entries: readonly SpecSnapshotEntry[] }>();
const rebuilding = new Set<string>();

function buildSnapshot(root: string): SpecSnapshotEntry[] {
	try {
		return rootIndexFor(root)
			.contentEntries()
			.map((entry) => {
				const id = scalar(entry.frontmatter, FIELDS.id) ?? "";
				return {
					path: entry.path,
					id,
					title: scalar(entry.frontmatter, FIELDS.title) ?? id,
					type: scalar(entry.frontmatter, FIELDS.type) ?? "",
					content: entry.content,
				};
			});
	} catch {
		return [];
	}
}

export interface SpecSnapshot {
	readonly entries: readonly SpecSnapshotEntry[];
	readonly rebuilding: boolean;
}

export function specSnapshot(root: string, now = Date.now()): SpecSnapshot {
	const cached = snapshots.get(root);
	if (!cached) {
		scheduleSnapshotRebuild(root);
		return { entries: [], rebuilding: true };
	}
	snapshots.delete(root);
	snapshots.set(root, cached);
	if (now - cached.at >= SNAPSHOT_TTL_MS) scheduleSnapshotRebuild(root);
	return { entries: cached.entries, rebuilding: rebuilding.has(root) };
}

function scheduleSnapshotRebuild(root: string): void {
	if (rebuilding.has(root)) return;
	rebuilding.add(root);
	setImmediate(() => {
		if (!rebuilding.delete(root)) return;
		snapshots.delete(root);
		snapshots.set(root, { at: Date.now(), entries: buildSnapshot(root) });
		for (const oldest of snapshots.keys()) {
			if (snapshots.size <= SNAPSHOT_ROOTS) break;
			evictSpecRoot(oldest);
		}
	});
}

export function invalidateSpecSnapshot(root: string): void {
	const cached = snapshots.get(root);
	if (cached) snapshots.set(root, { at: Number.NEGATIVE_INFINITY, entries: cached.entries });
}

export function evictSpecRoot(root: string): void {
	snapshots.delete(root);
	rebuilding.delete(root);
	projectIndexes.delete(root);
}

export function projectHasSpecs(root: string): boolean {
	const index = rootIndexFor(root);
	try {
		for (const node of index.graph().nodes.values()) {
			if (node.type !== "task-spec") return true;
		}
		return false;
	} catch {
		return false;
	}
}

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
