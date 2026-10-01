import type { ReviewThread } from "@/resources";
import { type JsonDiffClassification, oldToRenderedJsonPointers } from "./jsonDiff";
import { type JsonDocument, type JsonNode, jsonNodeOfAnchor } from "./jsonScanner";

export type JsonDiffSide = "base" | "worktree";

export interface JsonDiffThreadPlacement {
	thread: ReviewThread;
	number: number;
	side: JsonDiffSide;
	section: "current" | "removed";
	pointer: string;
}

export interface JsonDiffReviewLayout {
	placements: readonly JsonDiffThreadPlacement[];
	placedThreadIds: ReadonlySet<string>;
	removedNodes: readonly JsonNode[];
	baseRenderedPointers: ReadonlyMap<string, string>;
}

function removedAtOrAbove(pointer: string, removed: JsonDiffClassification["removed"]): boolean {
	let candidate = pointer;
	for (;;) {
		if (removed.has(candidate)) return true;
		const separator = candidate.lastIndexOf("/");
		if (separator < 0) return false;
		candidate = candidate.slice(0, separator);
	}
}

function topLevelRemovedNodes(
	document: JsonDocument | null,
	removed: JsonDiffClassification["removed"],
): JsonNode[] {
	if (!document) return [];
	const pointers = new Set(removed.keys());
	return [...pointers]
		.filter((pointer) => {
			let parent = pointer;
			while (parent.includes("/")) {
				parent = parent.slice(0, parent.lastIndexOf("/"));
				if (pointers.has(parent)) return false;
			}
			return true;
		})
		.flatMap((pointer) => {
			const node = document.nodes.get(pointer);
			return node ? [node] : [];
		});
}

function subtreePointers(node: JsonNode, target: Set<string>): void {
	target.add(node.pointer);
	for (const child of node.children) subtreePointers(child, target);
}

export function buildJsonDiffReviewLayout({
	originalPresent,
	modifiedPresent,
	originalDocument,
	modifiedDocument,
	classification,
	baseThreads,
	worktreeThreads,
}: {
	originalPresent: boolean;
	modifiedPresent: boolean;
	originalDocument: JsonDocument | null;
	modifiedDocument: JsonDocument | null;
	classification: JsonDiffClassification;
	baseThreads: readonly ReviewThread[];
	worktreeThreads: readonly ReviewThread[];
}): JsonDiffReviewLayout {
	if ((originalPresent && !originalDocument) || (modifiedPresent && !modifiedDocument)) {
		return {
			placements: [],
			placedThreadIds: new Set(),
			removedNodes: [],
			baseRenderedPointers: new Map(),
		};
	}
	const removedNodes = topLevelRemovedNodes(originalDocument, classification.removed);
	const removedPointers = new Set<string>();
	for (const node of removedNodes) subtreePointers(node, removedPointers);
	const oldToCurrent =
		originalDocument && modifiedDocument
			? oldToRenderedJsonPointers(
					originalDocument.value,
					modifiedDocument.value,
					classification.delta,
				)
			: new Map<string, string>();
	const placements: JsonDiffThreadPlacement[] = [];
	const baseRenderedPointers = new Map<string, string>();
	for (const thread of baseThreads) {
		if (!originalDocument) continue;
		const node = jsonNodeOfAnchor(thread.anchor, originalDocument);
		if (!node) continue;
		if (removedAtOrAbove(node.pointer, classification.removed)) {
			if (!removedPointers.has(node.pointer)) continue;
			placements.push({
				thread,
				number: placements.length + 1,
				side: "base",
				section: "removed",
				pointer: node.pointer,
			});
			baseRenderedPointers.set(node.pointer, node.pointer);
			continue;
		}
		const pointer = oldToCurrent.get(node.pointer);
		if (pointer === undefined || !modifiedDocument?.nodes.has(pointer)) continue;
		placements.push({
			thread,
			number: placements.length + 1,
			side: "base",
			section: "current",
			pointer,
		});
		baseRenderedPointers.set(node.pointer, pointer);
	}
	for (const thread of worktreeThreads) {
		if (!modifiedDocument) continue;
		const node = jsonNodeOfAnchor(thread.anchor, modifiedDocument);
		if (!node || !modifiedDocument.nodes.has(node.pointer)) continue;
		placements.push({
			thread,
			number: placements.length + 1,
			side: "worktree",
			section: "current",
			pointer: node.pointer,
		});
	}
	return {
		placements,
		placedThreadIds: new Set(placements.map(({ thread }) => thread.id)),
		removedNodes,
		baseRenderedPointers,
	};
}
