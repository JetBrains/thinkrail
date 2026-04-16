import { useCallback, useEffect, useState } from "react";
import { getProjectFiles } from "@/services/project.ts";
import { useUiStore } from "@/store/uiStore.ts";
import { useFileStore } from "@/store/fileStore.ts";
import "./FileTree.css";

interface FileEntry {
  path: string;
  name: string;
  isDir: boolean;
  depth: number;
}

/**
 * IntelliJ-style file type → icon mapping.
 * Uses plain text symbols that match JetBrains IDE appearance.
 */
function fileIcon(name: string, isDir: boolean): { icon: string; cls: string } {
  if (isDir) {
    // Special directories
    if (name === ".bonsai") return { icon: "S", cls: "fi-specs" };
    if (name === "src") return { icon: "S", cls: "fi-src" };
    if (name === "tests" || name === "test") return { icon: "T", cls: "fi-test" };
    return { icon: "", cls: "fi-dir" };
  }
  // Files by extension
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  switch (ext) {
    case "py": return { icon: "", cls: "fi-py" };
    case "ts": case "tsx": return { icon: "", cls: "fi-ts" };
    case "js": case "jsx": return { icon: "", cls: "fi-js" };
    case "css": return { icon: "", cls: "fi-css" };
    case "html": return { icon: "", cls: "fi-html" };
    case "json": return { icon: "", cls: "fi-json" };
    case "jsonl": return { icon: "", cls: "fi-json" };
    case "md": case "txt": return { icon: "", cls: "fi-md" };
    case "toml": case "yaml": case "yml": case "ini": case "cfg": return { icon: "", cls: "fi-config" };
    case "lock": return { icon: "", cls: "fi-lock" };
    default: return { icon: "", cls: "fi-default" };
  }
}

/** Get all directory paths from entries. */
function allDirPaths(entries: FileEntry[]): Set<string> {
  const dirs = new Set<string>();
  for (const e of entries) {
    if (e.isDir) dirs.add(e.path);
  }
  return dirs;
}

/**
 * Smart default collapse: collapse everything, then expand root-level dirs
 * and single-child directory chains (e.g. backend/ → app/ → core/).
 */
function computeDefaultCollapsed(entries: FileEntry[]): Set<string> {
  const dirs = allDirPaths(entries);
  const collapsed = new Set(dirs); // start with everything collapsed

  // Expand depth-0 directories
  for (const e of entries) {
    if (e.isDir && e.depth === 0) collapsed.delete(e.path);
  }

  // Auto-expand single-child chains: if a visible (expanded) dir has exactly
  // one direct child that is also a dir, expand that child too. Repeat until stable.
  let changed = true;
  while (changed) {
    changed = false;
    for (const e of entries) {
      if (!e.isDir || collapsed.has(e.path)) continue;
      // Find direct children that are directories
      const dirChildren = entries.filter(
        (c) => c.isDir && c.depth === e.depth + 1 && c.path.startsWith(e.path + "/"),
      );
      if (dirChildren.length === 1 && collapsed.has(dirChildren[0].path)) {
        collapsed.delete(dirChildren[0].path);
        changed = true;
      }
    }
  }

  return collapsed;
}

function storageKey(projectPath: string): string {
  return `bonsai-filetree-collapsed-${projectPath}`;
}

function showHiddenKey(projectPath: string): string {
  return `bonsai-filetree-showHidden-${projectPath}`;
}

function readShowHidden(projectPath: string): boolean {
  try {
    return localStorage.getItem(showHiddenKey(projectPath)) === "true";
  } catch { return false; }
}

function persistCollapsed(projectPath: string, set: Set<string>): void {
  try { localStorage.setItem(storageKey(projectPath), JSON.stringify([...set])); } catch { /* ignore */ }
}

function readPersistedCollapsed(projectPath: string): Set<string> | null {
  try {
    const val = localStorage.getItem(storageKey(projectPath));
    if (val !== null) return new Set(JSON.parse(val) as string[]);
  } catch { /* ignore */ }
  return null;
}

export function FileTree() {
  const projectPath = useUiStore((s) => s.projectPath);
  const fileTreeVersion = useUiStore((s) => s.fileTreeVersion);
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showHidden, setShowHidden] = useState(() =>
    projectPath ? readShowHidden(projectPath) : false,
  );

  const fetchFiles = useCallback(async () => {
    if (!projectPath) return;
    setLoading(true);
    try {
      const data = await getProjectFiles(projectPath, showHidden);
      const fetched: FileEntry[] = data.entries ?? [];
      setEntries(fetched);
      const persisted = readPersistedCollapsed(projectPath);
      setCollapsed(persisted ?? computeDefaultCollapsed(fetched));
    } catch {
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [projectPath, showHidden]);

  useEffect(() => {
    fetchFiles();
  }, [fetchFiles, fileTreeVersion]);

  const openFile = useFileStore((s) => s.openFile);
  const loadPreview = useFileStore((s) => s.loadPreview);

  const handleDoubleClick = useCallback(
    (entry: FileEntry) => {
      if (!entry.isDir) {
        const { previewFilePath, pinPreview } = useFileStore.getState();
        if (previewFilePath === entry.path) {
          pinPreview();
        } else {
          openFile(entry.path);
        }
      }
    },
    [openFile],
  );

  const toggleDir = useCallback((path: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      if (projectPath) persistCollapsed(projectPath, next);
      return next;
    });
  }, [projectPath]);

  const collapseAll = useCallback(() => {
    const dirs = allDirPaths(entries);
    setCollapsed(dirs);
    if (projectPath) persistCollapsed(projectPath, dirs);
  }, [entries, projectPath]);

  const expandAll = useCallback(() => {
    const empty = new Set<string>();
    setCollapsed(empty);
    if (projectPath) persistCollapsed(projectPath, empty);
  }, [projectPath]);

  const toggleShowHidden = useCallback(() => {
    setShowHidden((prev) => {
      const next = !prev;
      if (projectPath) {
        try { localStorage.setItem(showHiddenKey(projectPath), String(next)); } catch { /* ignore */ }
      }
      return next;
    });
  }, [projectPath]);

  if (loading) {
    return <div className="ft-empty">Loading...</div>;
  }

  if (entries.length === 0) {
    return <div className="ft-empty">Empty project</div>;
  }

  const visible = entries.filter((entry) => {
    const parts = entry.path.split("/");
    for (let i = 1; i < parts.length; i++) {
      const ancestor = parts.slice(0, i).join("/");
      if (collapsed.has(ancestor)) return false;
    }
    return true;
  });

  return (
    <div className="ft">
      <div className="ft-toolbar">
        <button className="ft-toolbar-btn" onClick={collapseAll} title="Collapse All">
          ⊟
        </button>
        <button className="ft-toolbar-btn" onClick={expandAll} title="Expand All">
          ⊞
        </button>
        <button
          className={`ft-toolbar-btn${showHidden ? " ft-toolbar-btn-active" : ""}`}
          onClick={toggleShowHidden}
          title={showHidden ? "Hide hidden files" : "Show hidden files"}
        >
          👁
        </button>
      </div>
      {visible.map((entry) => {
        const { cls } = fileIcon(entry.name, entry.isDir);
        const isOpen = entry.isDir && !collapsed.has(entry.path);
        const isSelected = selected === entry.path;

        return (
          <div
            key={entry.path}
            className={`ft-row ${isSelected ? "ft-row-selected" : ""}`}
            style={{ paddingLeft: entry.depth * 20 + 4 }}
            draggable={!entry.isDir}
            onDragStart={(e) => {
              e.dataTransfer.setData("text/plain", entry.path);
              e.dataTransfer.setData("application/x-bonsai-file", entry.path);
            }}
            onClick={() => {
              setSelected(entry.path);
              if (entry.isDir) {
                toggleDir(entry.path);
              } else {
                loadPreview(entry.path);
              }
            }}
            onDoubleClick={() => handleDoubleClick(entry)}
          >
            {/* Indent guides */}
            {entry.depth > 0 && (
              <span className="ft-guides">
                {Array.from({ length: entry.depth }, (_, i) => (
                  <span key={i} className="ft-guide-line" />
                ))}
              </span>
            )}

            {/* Expand/collapse arrow (dirs only) */}
            <span className={`ft-arrow ${entry.isDir ? "" : "ft-arrow-hidden"}`}>
              {entry.isDir ? (isOpen ? "\u25BE" : "\u25B8") : ""}
            </span>

            {/* File/folder icon */}
            <span className={`ft-icon ${cls}`}>
              {entry.isDir ? (isOpen ? "\u{1F4C2}" : "\u{1F4C1}") : "\u{1F4C4}"}
            </span>

            {/* Name */}
            <span className={`ft-name ${entry.isDir ? "ft-name-dir" : ""}`}>
              {entry.name}
            </span>
          </div>
        );
      })}
    </div>
  );
}
