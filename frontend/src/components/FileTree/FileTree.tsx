import { useCallback, useEffect, useState } from "react";
import { useUiStore } from "@/store/uiStore.ts";
import { useFileStore } from "@/store/fileStore.ts";
import "./FileTree.css";

const API_BASE = import.meta.env.DEV ? "http://localhost:8000" : "";

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
    if (name === ".specs") return { icon: "S", cls: "fi-specs" };
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
    case "md": case "txt": return { icon: "", cls: "fi-md" };
    case "toml": case "yaml": case "yml": case "ini": case "cfg": return { icon: "", cls: "fi-config" };
    case "lock": return { icon: "", cls: "fi-lock" };
    default: return { icon: "", cls: "fi-default" };
  }
}

export function FileTree() {
  const projectPath = useUiStore((s) => s.projectPath);
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchFiles = useCallback(async () => {
    if (!projectPath) return;
    setLoading(true);
    try {
      const res = await fetch(
        `${API_BASE}/api/project/files?path=${encodeURIComponent(projectPath)}`,
      );
      const data = await res.json();
      setEntries(data.entries ?? []);
    } catch {
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [projectPath]);

  useEffect(() => {
    fetchFiles();
  }, [fetchFiles]);

  const openFile = useFileStore((s) => s.openFile);

  const handleDoubleClick = useCallback(
    (entry: FileEntry) => {
      if (!entry.isDir) {
        openFile(entry.path);
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
      return next;
    });
  }, []);

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
      {visible.map((entry) => {
        const { cls } = fileIcon(entry.name, entry.isDir);
        const isOpen = entry.isDir && !collapsed.has(entry.path);
        const isSelected = selected === entry.path;

        return (
          <div
            key={entry.path}
            className={`ft-row ${isSelected ? "ft-row-selected" : ""}`}
            style={{ paddingLeft: entry.depth * 20 + 4 }}
            onClick={() => {
              setSelected(entry.path);
              if (entry.isDir) toggleDir(entry.path);
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
