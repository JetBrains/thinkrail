import type { DocumentEntry, SpecGraph, SpecEntry } from "@/types/spec.ts";

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
  const childrenOf = new Map<string | null, SpecEntry[]>();

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

/* ── Task dependency tree ── */

const TASK_STATUS_RANK: Record<string, number> = {
  active: 0,
  pending: 1,
  waiting: 2,
  stale: 3,
  done: 4,
};

export interface TaskTreeNode extends TaskInfo {
  depth: number;
}

/**
 * Build a depth-annotated flat list of tasks for a single spec,
 * ordered by intra-set dependency tree (roots first, dependents indented).
 * Siblings are sorted by status rank, then alphabetically.
 */
export function buildTaskTree(
  tasks: TaskInfo[],
  graph: SpecGraph,
): TaskTreeNode[] {
  const taskIds = new Set(tasks.map((t) => t.id));
  const taskById = new Map(tasks.map((t) => [t.id, t]));

  // Build intra-set dependency maps from "depends-on" edges
  // depsOf: taskId → [ids it depends ON]
  // dependents: taskId → [ids that depend on IT]
  const depsOf = new Map<string, string[]>();
  const dependents = new Map<string, string[]>();
  for (const edge of graph.edges) {
    if (edge.type !== "depends-on") continue;
    if (!taskIds.has(edge.from) || !taskIds.has(edge.to)) continue;
    depsOf.set(edge.from, [...(depsOf.get(edge.from) ?? []), edge.to]);
    dependents.set(edge.to, [...(dependents.get(edge.to) ?? []), edge.from]);
  }

  // Roots: tasks with no intra-set dependencies
  const roots = tasks.filter((t) => !(depsOf.get(t.id)?.length));

  const sortTasks = (arr: TaskInfo[]) =>
    [...arr].sort((a, b) => {
      const ra = TASK_STATUS_RANK[a.status] ?? 5;
      const rb = TASK_STATUS_RANK[b.status] ?? 5;
      return ra !== rb ? ra - rb : a.title.localeCompare(b.title);
    });

  // DFS flatten with depth tracking
  const result: TaskTreeNode[] = [];
  const visited = new Set<string>();

  function walk(taskId: string, depth: number) {
    if (visited.has(taskId)) return;
    visited.add(taskId);
    const task = taskById.get(taskId)!;
    result.push({ ...task, depth });
    const children = (dependents.get(taskId) ?? [])
      .map((id) => taskById.get(id)!)
      .filter(Boolean);
    for (const child of sortTasks(children)) {
      walk(child.id, depth + 1);
    }
  }

  for (const root of sortTasks(roots)) {
    walk(root.id, 0);
  }

  // Add any orphaned tasks not reached (circular deps edge case)
  for (const task of tasks) {
    if (!visited.has(task.id)) {
      result.push({ ...task, depth: 0 });
    }
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

/* ── Document tree (unmanaged docs) ── */

export interface DocTreeNode {
  /** Full relative path (for files) or collapsed display path (for dirs). */
  path: string;
  /** Display name — basename for files, collapsed dirname for dirs. */
  name: string;
  isDir: boolean;
  depth: number;
}

/**
 * Transform a flat DocumentEntry[] into a depth-sorted tree with
 * path-collapsing for empty intermediate directories (IntelliJ compact style).
 *
 * Pure function — no side effects, no store dependencies.
 */
export function buildDocTree(documents: DocumentEntry[]): DocTreeNode[] {
  if (documents.length === 0) return [];

  // 1. Collect all files and their parent directories
  interface DirNode {
    /** Display name after collapsing (may contain slashes). */
    name: string;
    /** Full path prefix for this dir (before collapsing). */
    fullPath: string;
    childDirs: Map<string, DirNode>;
    files: { path: string; name: string }[];
  }

  const root: DirNode = { name: "", fullPath: "", childDirs: new Map(), files: [] };

  for (const doc of documents) {
    const parts = doc.path.split("/");
    const fileName = parts.pop()!;
    let current = root;

    for (const part of parts) {
      if (!current.childDirs.has(part)) {
        const parentPath = current.fullPath ? current.fullPath + "/" + part : part;
        current.childDirs.set(part, {
          name: part,
          fullPath: parentPath,
          childDirs: new Map(),
          files: [],
        });
      }
      current = current.childDirs.get(part)!;
    }

    current.files.push({ path: doc.path, name: fileName });
  }

  // 2. Collapse empty intermediate directories
  function collapse(node: DirNode): DirNode {
    // First, recurse into children
    const collapsedChildren = new Map<string, DirNode>();
    for (const [key, child] of node.childDirs) {
      collapsedChildren.set(key, collapse(child));
    }
    node.childDirs = collapsedChildren;

    // If this dir has exactly one child dir and zero files, merge
    if (node.childDirs.size === 1 && node.files.length === 0) {
      const [, onlyChild] = [...node.childDirs.entries()][0];
      return {
        name: node.name ? node.name + "/" + onlyChild.name : onlyChild.name,
        fullPath: onlyChild.fullPath,
        childDirs: onlyChild.childDirs,
        files: onlyChild.files,
      };
    }

    return node;
  }

  // Collapse from root's children (root itself is virtual)
  const collapsedRoot: DirNode = collapse(root);

  // 3. DFS flatten — dirs first (alphabetical), then files (alphabetical)
  const result: DocTreeNode[] = [];

  function walk(node: DirNode, depth: number, isRoot: boolean) {
    if (!isRoot) {
      result.push({
        path: node.fullPath,
        name: node.name,
        isDir: true,
        depth,
      });
    }

    const childDepth = isRoot ? depth : depth + 1;

    // Sort child dirs alphabetically by display name
    const sortedDirs = [...node.childDirs.values()].sort((a, b) =>
      a.name.localeCompare(b.name),
    );

    // Sort files alphabetically
    const sortedFiles = [...node.files].sort((a, b) =>
      a.name.localeCompare(b.name),
    );

    for (const dir of sortedDirs) {
      walk(dir, childDepth, false);
    }

    for (const file of sortedFiles) {
      result.push({
        path: file.path,
        name: file.name,
        isDir: false,
        depth: childDepth,
      });
    }
  }

  walk(collapsedRoot, 0, true);
  return result;
}
