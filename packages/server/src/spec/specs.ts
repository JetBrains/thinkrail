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
const rebuilding = new Map<string, Promise<void>>();

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
	readonly built: boolean;
	readonly rebuilding: Promise<void> | null;
}

export function specSnapshot(root: string, now = Date.now()): SpecSnapshot {
	const cached = snapshots.get(root);
	if (!cached) return { entries: [], built: false, rebuilding: scheduleSnapshotRebuild(root) };
	snapshots.delete(root);
	snapshots.set(root, cached);
	const pending =
		now - cached.at >= SNAPSHOT_TTL_MS
			? scheduleSnapshotRebuild(root)
			: (rebuilding.get(root) ?? null);
	return { entries: cached.entries, built: true, rebuilding: pending };
}

function scheduleSnapshotRebuild(root: string): Promise<void> {
	const pending = rebuilding.get(root);
	if (pending) return pending;
	const { promise, resolve } = Promise.withResolvers<void>();
	rebuilding.set(root, promise);
	setImmediate(() => {
		if (rebuilding.get(root) === promise) {
			rebuilding.delete(root);
			snapshots.delete(root);
			snapshots.set(root, { at: Date.now(), entries: buildSnapshot(root) });
			for (const oldest of snapshots.keys()) {
				if (snapshots.size <= SNAPSHOT_ROOTS) break;
				evictSpecRoot(oldest);
			}
		}
		resolve();
	});
	return promise;
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
