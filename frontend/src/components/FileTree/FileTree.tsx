import { useCallback, useEffect, useState } from "react";
import { useUiStore } from "@/store/uiStore.ts";
import "./FileTree.css";

const API_BASE = import.meta.env.DEV ? "http://localhost:8000" : "";

interface FileEntry {
  path: string;
  name: string;
  isDir: boolean;
  depth: number;
}

function fileIcon(name: string, isDir: boolean): string {
  if (isDir) return "\u{1F4C1}";
  if (name.endsWith(".md")) return "\u{1F4C4}";
  if (name.endsWith(".py")) return "\u{1F40D}";
  if (name.endsWith(".ts") || name.endsWith(".tsx")) return "\u{1F535}";
  if (name.endsWith(".css")) return "\u{1F3A8}";
  if (name.endsWith(".json")) return "\u{1F4CB}";
  if (name.endsWith(".html")) return "\u{1F310}";
  return "\u{1F4C4}";
}

export function FileTree() {
  const projectPath = useUiStore((s) => s.projectPath);
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
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
    return <div className="file-tree-loading">Loading files...</div>;
  }

  if (entries.length === 0) {
    return <div className="file-tree-empty">No files</div>;
  }

  // Filter out entries whose parent directory is collapsed
  const visible = entries.filter((entry) => {
    const parts = entry.path.split("/");
    for (let i = 1; i < parts.length; i++) {
      const ancestor = parts.slice(0, i).join("/");
      if (collapsed.has(ancestor)) return false;
    }
    return true;
  });

  return (
    <div className="file-tree">
      {visible.map((entry) => (
        <div
          key={entry.path}
          className={`file-tree-entry ${entry.isDir ? "file-tree-dir" : "file-tree-file"}`}
          style={{ paddingLeft: entry.depth * 16 + 8 }}
          onClick={entry.isDir ? () => toggleDir(entry.path) : undefined}
        >
          {entry.isDir && (
            <span className="file-tree-arrow">
              {collapsed.has(entry.path) ? "\u25B6" : "\u25BC"}
            </span>
          )}
          <span className="file-tree-icon">{fileIcon(entry.name, entry.isDir)}</span>
          <span className="file-tree-name">{entry.name}</span>
        </div>
      ))}
    </div>
  );
}
