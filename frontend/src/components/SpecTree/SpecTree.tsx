import { useCallback, useEffect, useMemo, useState } from "react";
import { useSpecStore } from "@/store/specStore.ts";
import { useFileStore } from "@/store/fileStore.ts";
import {
  buildTree,
  getTasksForSpec,

  specTypeIcon,
  statusBadge,
} from "./treeUtils.ts";
import "./SpecTree.css";

export function SpecTree() {
  const specs = useSpecStore((s) => s.specs);
  const graph = useSpecStore((s) => s.graph);
  const selectedSpecId = useSpecStore((s) => s.selectedSpecId);
  const selectSpec = useSpecStore((s) => s.selectSpec);
  const fetchSpecs = useSpecStore((s) => s.fetchSpecs);
  const fetchGraph = useSpecStore((s) => s.fetchGraph);
  const loading = useSpecStore((s) => s.loading);
  const error = useSpecStore((s) => s.error);
  const openFile = useFileStore((s) => s.openFile);
  const loadPreview = useFileStore((s) => s.loadPreview);
  const pinPreview = useFileStore((s) => s.pinPreview);

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [expandedTasks, setExpandedTasks] = useState<Set<string>>(new Set());

  // Fetch data on mount if not already loaded
  useEffect(() => {
    if (specs.length === 0) fetchSpecs();
    if (!graph) fetchGraph();
  }, [specs.length, graph, fetchSpecs, fetchGraph]);

  // Build flat tree from graph (excludes task-spec nodes)
  const nodes = useMemo(() => (graph ? buildTree(graph) : []), [graph]);

  // Build task map: specId → TaskInfo[]
  const taskMap = useMemo(
    () => (graph ? getTasksForSpec(graph) : new Map<string, never[]>()),
    [graph],
  );

  // Filter visible nodes — hide children of collapsed ancestors
  const visible = useMemo(() => {
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));
    return nodes.filter((node) => {
      let current = node.parentId;
      while (current) {
        if (collapsed.has(current)) return false;
        current = nodeMap.get(current)?.parentId ?? null;
      }
      return true;
    });
  }, [nodes, collapsed]);

  const toggleCollapse = useCallback((id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const toggleTasksExpanded = useCallback((id: string) => {
    setExpandedTasks((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const handleClick = useCallback(
    (id: string, path: string) => {
      selectSpec(id);
      loadPreview(path);
    },
    [selectSpec, loadPreview],
  );

  const handleArrowClick = useCallback(
    (e: React.MouseEvent, id: string) => {
      e.stopPropagation();
      toggleCollapse(id);
    },
    [toggleCollapse],
  );

  const handlePillClick = useCallback(
    (e: React.MouseEvent, id: string) => {
      e.stopPropagation();
      toggleTasksExpanded(id);
    },
    [toggleTasksExpanded],
  );

  const handleDoubleClick = useCallback(
    (path: string) => {
      const { previewFilePath } = useFileStore.getState();
      if (previewFilePath === path) {
        pinPreview();
      } else {
        openFile(path);
      }
    },
    [openFile, pinPreview],
  );

  if (loading && !graph) {
    return <div className="st-empty">Loading specs...</div>;
  }

  if (error) {
    return <div className="st-empty st-error">{error}</div>;
  }

  if (graph && nodes.length === 0) {
    return <div className="st-empty">No specifications yet</div>;
  }

  return (
    <div className="st">
      {visible.map((node) => {
        const isSelected = selectedSpecId === node.id;
        const isOpen = node.hasChildren && !collapsed.has(node.id);
        const icon = specTypeIcon(node.type);
        const badge = statusBadge(node.status);
        const tasks = taskMap.get(node.id);
        const taskCount = tasks?.length ?? 0;
        const tasksOpen = expandedTasks.has(node.id);
        const hasActiveTasks =
          taskCount > 0 && tasks!.some((t) => t.status === "active");

        return (
          <div key={node.id}>
            {/* Spec row */}
            <div
              className={`st-row ${isSelected ? "st-row-selected" : ""}`}
              style={{ paddingLeft: node.depth * 20 + 4 }}
              onClick={() => handleClick(node.id, node.path)}
              onDoubleClick={() => handleDoubleClick(node.path)}
              title={node.path}
            >
              {/* Indent guides */}
              {node.depth > 0 && (
                <span className="st-guides">
                  {Array.from({ length: node.depth }, (_, i) => (
                    <span key={i} className="st-guide-line" />
                  ))}
                </span>
              )}

              {/* Expand/collapse arrow */}
              <span
                className={`st-arrow ${node.hasChildren ? "" : "st-arrow-hidden"}`}
                onClick={
                  node.hasChildren
                    ? (e) => handleArrowClick(e, node.id)
                    : undefined
                }
              >
                {node.hasChildren ? (isOpen ? "\u25BE" : "\u25B8") : ""}
              </span>

              {/* Type icon */}
              <span className={`st-icon ${icon.cls}`}>{icon.icon}</span>

              {/* Title */}
              <span
                className={`st-title ${node.hasChildren ? "st-title-parent" : ""}`}
              >
                {node.title}
              </span>

              {/* Task count pill — hidden for 0 tasks */}
              {taskCount > 0 && (
                <span
                  className={`st-task-pill ${
                    tasksOpen
                      ? "st-task-pill-expanded"
                      : hasActiveTasks
                        ? "st-task-pill-active"
                        : "st-task-pill-done"
                  }`}
                  onClick={(e) => handlePillClick(e, node.id)}
                >
                  {taskCount} {taskCount === 1 ? "task" : "tasks"}
                </span>
              )}

              {/* Status badge */}
              <span className={`st-badge ${badge.cls}`}>{badge.badge}</span>
            </div>

            {/* Task card — expanded below the row */}
            {tasksOpen && tasks && (
              <div
                className="st-task-card"
                style={{ marginLeft: node.depth * 20 + 20 }}
                role="group"
                aria-label={`Tasks for ${node.title}`}
              >
                {tasks.map((task) => {
                  const tBadge = statusBadge(task.status);
                  return (
                    <div
                      key={task.id}
                      className="st-task-card-row"
                      onClick={() => loadPreview(task.path)}
                      onDoubleClick={() => handleDoubleClick(task.path)}
                    >
                      <span className="st-icon st-icon-task">
                        {"\u270F\uFE0F"}
                      </span>
                      <span className="st-title">{task.title}</span>
                      <span className={`st-badge ${tBadge.cls}`}>
                        {tBadge.badge}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
