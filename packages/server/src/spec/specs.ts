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
const rebuilding = new Map<string, Promise<void>>();

const MAX_SECTION_INDEX_ROOTS = 4;
const sectionIndexes = new Map<string, SectionIndex>();
const sectionsWanted = new Set<string>();

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
			const entries = readEntries(root);
			snapshots.delete(root);
			snapshots.set(root, { at: Date.now(), entries: snapshotOf(entries) });
			if (sectionsWanted.delete(root) || sectionIndexes.has(root)) storeSections(root, entries);
			for (const oldest of snapshots.keys()) {
				if (snapshots.size <= SNAPSHOT_ROOTS) break;
				evictSpecRoot(oldest);
			}
		}
		resolve();
	});
	return promise;
}

export interface SpecSections {
	readonly built: boolean;
	readonly rebuilding: Promise<void> | null;
	search(query: string, limit: number): { hits: readonly SpecSectionHit[]; total: number };
}

const NO_SECTIONS = { hits: [], total: 0 };

export function specSections(root: string, now = Date.now()): SpecSections {
	const index = sectionIndexes.get(root);
	if (!index) {
		sectionsWanted.add(root);
		return { built: false, rebuilding: scheduleSnapshotRebuild(root), search: () => NO_SECTIONS };
	}
	sectionIndexes.delete(root);
	sectionIndexes.set(root, index);
	return {
		built: true,
		rebuilding: specSnapshot(root, now).rebuilding,
		search: (query, limit) => searchSpecs(index, query, { limit }),
	};
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
	sectionsWanted.delete(root);
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
