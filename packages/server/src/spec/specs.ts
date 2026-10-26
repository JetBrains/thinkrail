import type { SpecGraphNode, SpecGraphSnapshot } from "@thinkrail/contracts";
import {
	FIELDS,
	indexSections,
	list,
	type SectionIndex,
	type SpecContentEntry,
	SpecIndex,
	type SpecSectionHit,
	scalar,
	searchSpecs,
} from "pi-spec-graph/core";
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

const MAX_SECTION_INDEX_ROOTS = 4;
const sectionIndexes = new Map<string, SectionIndex>();
const sectionBuilds = new Set<string>();

function readEntries(root: string): SpecContentEntry[] {
	try {
		return rootIndexFor(root).contentEntries();
	} catch {
		return [];
	}
}

function snapshotOf(entries: readonly SpecContentEntry[]): SpecSnapshotEntry[] {
	return entries.map((entry) => {
		const id = scalar(entry.frontmatter, FIELDS.id) ?? "";
		return {
			path: entry.path,
			id,
			title: scalar(entry.frontmatter, FIELDS.title) ?? id,
			type: scalar(entry.frontmatter, FIELDS.type) ?? "",
			content: entry.content,
		};
	});
}

function storeSections(root: string, entries: readonly SpecContentEntry[]): void {
	const next = indexSections(entries, sectionIndexes.get(root));
	sectionIndexes.delete(root);
	sectionIndexes.set(root, next);
	for (const oldest of sectionIndexes.keys()) {
		if (sectionIndexes.size <= MAX_SECTION_INDEX_ROOTS) break;
		sectionIndexes.delete(oldest);
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
		const entries = readEntries(root);
		snapshots.delete(root);
		snapshots.set(root, { at: Date.now(), entries: snapshotOf(entries) });
		if (sectionIndexes.has(root)) storeSections(root, entries);
		for (const oldest of snapshots.keys()) {
			if (snapshots.size <= SNAPSHOT_ROOTS) break;
			evictSpecRoot(oldest);
		}
	});
}

function scheduleSectionBuild(root: string): void {
	if (sectionBuilds.has(root)) return;
	sectionBuilds.add(root);
	setImmediate(() => {
		if (!sectionBuilds.delete(root)) return;
		storeSections(root, readEntries(root));
	});
}

export interface SpecSectionSearch {
	readonly hits: readonly SpecSectionHit[];
	readonly total: number;
	/** No index yet, or the specs are being re-read: a caller may ask again shortly. */
	readonly indexing: boolean;
}

/** Ranked section search over a root's specs; the root's first search only schedules its index, so no request tokenizes the tree. */
export function searchSpecSections(
	root: string,
	query: string,
	limit: number,
	now = Date.now(),
): SpecSectionSearch {
	const { rebuilding: stale } = specSnapshot(root, now);
	const index = sectionIndexes.get(root);
	if (!index) {
		scheduleSectionBuild(root);
		return { hits: [], total: 0, indexing: true };
	}
	sectionIndexes.delete(root);
	sectionIndexes.set(root, index);
	const { hits, total } = searchSpecs(index, query, { limit });
	return { hits, total, indexing: stale };
}

export function invalidateSpecSnapshot(root: string): void {
	const cached = snapshots.get(root);
	if (cached) snapshots.set(root, { at: Number.NEGATIVE_INFINITY, entries: cached.entries });
}

export function evictSpecRoot(root: string): void {
	snapshots.delete(root);
	rebuilding.delete(root);
	projectIndexes.delete(root);
	sectionIndexes.delete(root);
	sectionBuilds.delete(root);
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
