import { useCallback, useMemo, useState } from "react";
import { useSpecStore } from "@/store/specStore.ts";
import { useFileStore } from "@/store/fileStore.ts";
import { GraphModal } from "@/components/GraphView/GraphModal.tsx";
import {
  buildDocTree,
  buildTree,
  buildTaskTree,
  getTasksForSpec,
  specTypeIcon,
  statusBadge,
} from "./treeUtils.ts";
import "./SpecTree.css";

export function SpecTree() {
  const graph = useSpecStore((s) => s.graph);
  const selectedSpecId = useSpecStore((s) => s.selectedSpecId);
  const selectSpec = useSpecStore((s) => s.selectSpec);
  const loading = useSpecStore((s) => s.loading);
  const error = useSpecStore((s) => s.error);
  const openFile = useFileStore((s) => s.openFile);
  const loadPreview = useFileStore((s) => s.loadPreview);
  const pinPreview = useFileStore((s) => s.pinPreview);
  const [graphOpen, setGraphOpen] = useState(false);

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [expandedTasks, setExpandedTasks] = useState<Set<string>>(new Set());
  const [docsCollapsed, setDocsCollapsed] = useState(true);
  const [docDirCollapsed, setDocDirCollapsed] = useState<Set<string>>(new Set());

  // Initial fetch is handled by App.tsx after WebSocket connects.
  // No useEffect needed here — the store updates trigger re-render.

  // Build flat tree from graph (excludes task-spec nodes)
  const nodes = useMemo(() => (graph ? buildTree(graph) : []), [graph]);

  // Build task map: specId → TaskInfo[]
  const taskMap = useMemo(
    () => (graph ? getTasksForSpec(graph) : new Map<string, never[]>()),
    [graph],
  );

  // Build doc tree from unmanaged documents
  const docTree = useMemo(
    () => (graph?.documents ? buildDocTree(graph.documents) : []),
    [graph?.documents],
  );

  // Filter visible doc tree nodes — hide children of collapsed dirs
  const visibleDocs = useMemo(() => {
    return docTree.filter((node) => {
      // Check if any ancestor dir is collapsed
      const parts = node.path.split("/");
      // Walk up the path to check all possible parent dirs
      let prefix = "";
      for (let i = 0; i < parts.length - 1; i++) {
        prefix = prefix ? prefix + "/" + parts[i] : parts[i];
        if (docDirCollapsed.has(prefix)) return false;
      }
      return true;
    });
  }, [docTree, docDirCollapsed]);

  const toggleDocDir = useCallback((dirPath: string) => {
    setDocDirCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(dirPath)) {
        next.delete(dirPath);
      } else {
        next.add(dirPath);
      }
      return next;
    });
  }, []);

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

  if (graph && nodes.length === 0 && (!graph.documents || graph.documents.length === 0)) {
    return <div className="st-empty">No specifications yet</div>;
  }

  return (
    <div className="st">
      {graphOpen && <GraphModal onClose={() => setGraphOpen(false)} />}
      <div className="st-toolbar">
        <button
          className="st-graph-btn"
          onClick={() => setGraphOpen(true)}
          title="Open graph view"
          disabled={!graph}
        >
          ⬡ Graph
        </button>
      </div>
      {visible.map((node) => {
        const isSelected = selectedSpecId === node.id;
        const isOpen = node.hasChildren && !collapsed.has(node.id);
        const icon = specTypeIcon(node.type);
        const badge = statusBadge(node.status);
        const tasks = taskMap.get(node.id);
        const taskCount = tasks?.length ?? 0;
        const tasksOpen = expandedTasks.has(node.id);
        const doneCount =
          tasks?.filter((t) => t.status === "done").length ?? 0;

        const pillCls = tasksOpen
          ? "st-task-pill-expanded"
          : doneCount === taskCount
            ? "st-task-pill-alldone"
            : doneCount > 0
              ? "st-task-pill-progress"
              : "st-task-pill-none";

        const pillIcon =
          doneCount === taskCount
            ? "\u2713"
            : doneCount > 0
              ? "\u25D1"
              : "\u25CB";

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

              {/* Task completion pill — always visible when tasks > 0 */}
              {taskCount > 0 && (
                <span
                  className={`st-task-pill ${pillCls}`}
                  onClick={(e) => handlePillClick(e, node.id)}
                >
                  {pillIcon} {doneCount}/{taskCount}
                </span>
              )}

              {/* Status badge */}
              <span className={`st-badge ${badge.cls}`}>{badge.badge}</span>
            </div>

            {/* Task card — expanded below the row */}
            {tasksOpen && tasks && graph && (
              <div
                className="st-task-card"
                style={{ marginLeft: node.depth * 20 + 20 }}
                role="group"
                aria-label={`Tasks for ${node.title}`}
              >
                {buildTaskTree(tasks, graph).map((task) => {
                  const tBadge = statusBadge(task.status);
                  return (
                    <div
                      key={task.id}
                      className="st-task-card-row"
                      style={{ paddingLeft: task.depth * 16 + 10 }}
                      onClick={() => loadPreview(task.path)}
                      onDoubleClick={() => handleDoubleClick(task.path)}
                    >
                      {task.depth > 0 && (
                        <span className="st-task-dep-arrow">{"\u21B3"}</span>
                      )}
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

      {/* Unmanaged documents section */}
      {graph?.documents && graph.documents.length > 0 && (
        <>
          <div
            className="st-doc-header"
            onClick={() => setDocsCollapsed(!docsCollapsed)}
          >
            <span className="st-arrow">
              {docsCollapsed ? "\u25B8" : "\u25BE"}
            </span>
            <span className="st-icon st-icon-default">{"\uD83D\uDCC4"}</span>
            <span className="st-title">
              Unmanaged Documents ({graph.documents.length})
            </span>
          </div>
          {!docsCollapsed &&
            visibleDocs.map((node) =>
              node.isDir ? (
                <div
                  key={`dir:${node.path}`}
                  className="st-doc-dir"
                  style={{ paddingLeft: node.depth * 20 + 4 }}
                  onClick={() => toggleDocDir(node.path)}
                  title={node.path}
                >
                  <span className="st-doc-dir-arrow">
                    {docDirCollapsed.has(node.path) ? "\u25B8" : "\u25BE"}
                  </span>
                  <span className="st-doc-dir-icon">{"\uD83D\uDCC1"}</span>
                  <span className="st-doc-dir-name">{node.name}</span>
                </div>
              ) : (
                <div
                  key={node.path}
                  className="st-doc-row"
                  style={{ paddingLeft: node.depth * 20 + 4 }}
                  onClick={() => loadPreview(node.path)}
                  onDoubleClick={() => handleDoubleClick(node.path)}
                  title={node.path}
                >
                  <span className="st-doc-row-icon">{"\uD83D\uDCC4"}</span>
                  <span className="st-doc-row-name">{node.name}</span>
                </div>
              ),
            )}
        </>
      )}
    </div>
  );
}
