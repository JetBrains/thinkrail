import type { SpecGraph, RegistryEntry } from "@/types/spec.ts";

export interface TreeNode {
  id: string;
  title: string;
  type: string;
  status: string;
  path: string;
  depth: number;
  parentId: string | null;
  hasChildren: boolean;
}

export interface TaskInfo {
  id: string;
  title: string;
  status: string;
  path: string;
}

const TYPE_RANK: Record<string, number> = {
  "goal-and-requirements": 0,
  "architecture-design": 1,
  "module-design": 2,
  "submodule-design": 3,
  "task-spec": 4,
};

/**
 * Transform a SpecGraph into a flat, depth-sorted list of TreeNodes.
 * Parent edges (from=child, to=parent) define the hierarchy.
 * Sorted by type rank within each level, then alphabetically.
 */
export function buildTree(graph: SpecGraph): TreeNode[] {
  const parentOf = new Map<string, string>();
  const childrenOf = new Map<string | null, RegistryEntry[]>();

  // Extract parent relationships from edges
  for (const edge of graph.edges) {
    if (edge.type === "parent") {
      parentOf.set(edge.from, edge.to);
    }
  }

  // Group nodes by parent (exclude task-spec nodes — shown via task pills instead)
  for (const node of graph.nodes) {
    if (node.type === "task-spec") continue;
    const pid = parentOf.get(node.id) ?? null;
    const siblings = childrenOf.get(pid) ?? [];
    siblings.push(node);
    childrenOf.set(pid, siblings);
  }

  // Sort each group by type rank, then title
  for (const [, children] of childrenOf) {
    children.sort((a, b) => {
      const ra = TYPE_RANK[a.type] ?? 5;
      const rb = TYPE_RANK[b.type] ?? 5;
      return ra !== rb ? ra - rb : a.title.localeCompare(b.title);
    });
  }

  // DFS flatten
  const result: TreeNode[] = [];
  function walk(pid: string | null, depth: number) {
    for (const entry of childrenOf.get(pid) ?? []) {
      const kids = childrenOf.get(entry.id) ?? [];
      result.push({
        id: entry.id,
        title: entry.title,
        type: entry.type,
        status: entry.status,
        path: entry.path,
        depth,
        parentId: pid,
        hasChildren: kids.length > 0,
      });
      walk(entry.id, depth + 1);
    }
  }
  walk(null, 0);
  return result;
}

/** Map spec type to an icon character and CSS class. */
export function specTypeIcon(type: string): { icon: string; cls: string } {
  switch (type) {
    case "goal-and-requirements":
      return { icon: "\u{1F3AF}", cls: "st-icon-goal" };
    case "architecture-design":
      return { icon: "\u{1F3D7}", cls: "st-icon-arch" };
    case "module-design":
      return { icon: "\u{1F4E6}", cls: "st-icon-module" };
    case "submodule-design":
      return { icon: "\u{1F9E9}", cls: "st-icon-submodule" };
    case "task-spec":
      return { icon: "\u270F\uFE0F", cls: "st-icon-task" };
    default:
      return { icon: "\u{1F4C4}", cls: "st-icon-default" };
  }
}

/**
 * Build a map of specId → TaskInfo[] using `implements` edges.
 * Tasks (type=task-spec) are associated with the spec they implement.
 */
export function getTasksForSpec(graph: SpecGraph): Map<string, TaskInfo[]> {
  const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]));
  const result = new Map<string, TaskInfo[]>();

  for (const edge of graph.edges) {
    if (edge.type !== "implements") continue;
    const taskNode = nodeMap.get(edge.from);
    if (!taskNode || taskNode.type !== "task-spec") continue;

    const tasks = result.get(edge.to) ?? [];
    tasks.push({ id: taskNode.id, title: taskNode.title, status: taskNode.status, path: taskNode.path });
    result.set(edge.to, tasks);
  }

  return result;
}

/** Map spec status to a badge character and CSS class. */
export function statusBadge(status: string): { badge: string; cls: string } {
  switch (status) {
    case "done":
      return { badge: "\u2713", cls: "st-badge-done" };
    case "active":
      return { badge: "\u25CF", cls: "st-badge-active" };
    case "pending":
      return { badge: "\u25CB", cls: "st-badge-pending" };
    case "stale":
      return { badge: "~", cls: "st-badge-stale" };
    case "waiting":
      return { badge: "!", cls: "st-badge-waiting" };
    default:
      return { badge: "\u00B7", cls: "st-badge-unknown" };
  }
}
