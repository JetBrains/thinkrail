import type { SpecEntry, Link, SpecGraph } from "@/types/spec.ts";

export const NODE_WIDTH = 160;
export const NODE_HEIGHT = 38;
export const H_GAP = 30;
export const V_GAP = 50;
export const PADDING = 20;

export interface NodePosition {
  node: SpecEntry;
  x: number;
  y: number;
}

export interface LayerView {
  root: SpecEntry | null;
  children: SpecEntry[];
  intraEdges: Link[];
  breadcrumb: SpecEntry[];
}

export interface Transform {
  scale: number;
  translateX: number;
  translateY: number;
}

const TYPE_RANK: Record<string, number> = {
  "goal-and-requirements": 0,
  "architecture-design": 1,
  "module-design": 2,
  "submodule-design": 3,
  "task-spec": 4,
};

function getRank(type: string): number {
  return TYPE_RANK[type] ?? 3;
}

export function findRoots(graph: SpecGraph): SpecEntry[] {
  const hasParent = new Set<string>();
  for (const edge of graph.edges) {
    if (edge.type === "parent" || edge.type === "implements") {
      hasParent.add(edge.from);
    }
  }
  return graph.nodes.filter((n) => !hasParent.has(n.id));
}

export function getStructuralChildren(
  graph: SpecGraph,
  parentId: string,
): SpecEntry[] {
  const childIds = new Set<string>();
  for (const edge of graph.edges) {
    if (
      (edge.type === "parent" || edge.type === "implements") &&
      edge.to === parentId
    ) {
      childIds.add(edge.from);
    }
  }
  return graph.nodes.filter((n) => childIds.has(n.id));
}

export function computeLayer(
  graph: SpecGraph,
  rootId: string | null,
): LayerView {
  const children =
    rootId === null ? findRoots(graph) : getStructuralChildren(graph, rootId);

  const visibleIds = new Set(children.map((c) => c.id));
  if (rootId) visibleIds.add(rootId);

  const intraEdges = graph.edges.filter(
    (e) => visibleIds.has(e.from) && visibleIds.has(e.to),
  );

  const root = rootId
    ? (graph.nodes.find((n) => n.id === rootId) ?? null)
    : null;

  return {
    root,
    children,
    intraEdges,
    breadcrumb: buildBreadcrumb(graph, rootId),
  };
}

export function buildBreadcrumb(
  graph: SpecGraph,
  nodeId: string | null,
): SpecEntry[] {
  const trail: SpecEntry[] = [];
  let current = nodeId;
  while (current) {
    const node = graph.nodes.find((n) => n.id === current);
    if (node) trail.unshift(node);
    const parentEdge = graph.edges.find(
      (e) =>
        (e.type === "parent" || e.type === "implements") &&
        e.from === current,
    );
    current = parentEdge ? parentEdge.to : null;
  }
  return trail;
}

export function layoutNodes(
  nodes: SpecEntry[],
  canvasWidth: number,
): NodePosition[] {
  // Group by rank
  const groups = new Map<number, SpecEntry[]>();
  for (const node of nodes) {
    const rank = getRank(node.type);
    const group = groups.get(rank) ?? [];
    group.push(node);
    groups.set(rank, group);
  }

  const positions: NodePosition[] = [];
  let currentY = PADDING;

  const sortedRanks = Array.from(groups.keys()).sort((a, b) => a - b);
  for (const rank of sortedRanks) {
    const row = groups.get(rank)!;
    const totalWidth = row.length * NODE_WIDTH + (row.length - 1) * H_GAP;
    const startX = Math.max(PADDING, (canvasWidth - totalWidth) / 2);

    for (let i = 0; i < row.length; i++) {
      positions.push({
        node: row[i],
        x: startX + i * (NODE_WIDTH + H_GAP),
        y: currentY,
      });
    }
    currentY += NODE_HEIGHT + V_GAP;
  }

  return positions;
}

export function fitToView(
  positions: NodePosition[],
  canvasW: number,
  canvasH: number,
): Transform {
  if (positions.length === 0) {
    return { scale: 1, translateX: 0, translateY: 0 };
  }

  const minX = Math.min(...positions.map((p) => p.x));
  const maxX = Math.max(...positions.map((p) => p.x + NODE_WIDTH));
  const minY = Math.min(...positions.map((p) => p.y));
  const maxY = Math.max(...positions.map((p) => p.y + NODE_HEIGHT));

  const contentW = maxX - minX + 2 * PADDING;
  const contentH = maxY - minY + 2 * PADDING;

  const scale = Math.min(canvasW / contentW, canvasH / contentH, 1.5);

  return {
    scale,
    translateX:
      (canvasW - contentW * scale) / 2 - minX * scale + PADDING * scale,
    translateY:
      (canvasH - contentH * scale) / 2 - minY * scale + PADDING * scale,
  };
}
