import { useCallback, useEffect, useMemo, useState } from "react";
import { useUiStore } from "@/store/uiStore.ts";
import "./FileSelector.css";

interface FileEntry {
  path: string;
  name: string;
  isDir: boolean;
  depth: number;
}

interface FileSelectorProps {
  selectedPaths: string[];
  onToggle: (path: string) => void;
}

export function FileSelector({ selectedPaths, onToggle }: FileSelectorProps) {
  const projectPath = useUiStore((s) => s.projectPath);
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!projectPath) return;
    fetch(`/api/project/files?path=${encodeURIComponent(projectPath)}`)
      .then((r) => r.json())
      .then((data) => {
        const fetched: FileEntry[] = data.entries ?? [];
        setEntries(fetched);
        // Collapse all directories by default
        const dirs = new Set<string>();
        for (const e of fetched) if (e.isDir) dirs.add(e.path);
        setCollapsed(dirs);
      })
      .catch(() => {});
  }, [projectPath]);

  const toggleDir = useCallback((path: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  }, []);

  const visible = useMemo(() => {
    const q = search.toLowerCase();
    const result: FileEntry[] = [];
    for (const entry of entries) {
      // If searching, show only matching files (skip dirs)
      if (q) {
        if (!entry.isDir && entry.name.toLowerCase().includes(q)) {
          result.push(entry);
        }
        continue;
      }
      // Normal tree: skip children of collapsed dirs
      let hidden = false;
      for (const dir of collapsed) {
        if (entry.path !== dir && entry.path.startsWith(dir + "/")) {
          hidden = true;
          break;
        }
      }
      if (!hidden) result.push(entry);
    }
    return result;
  }, [entries, collapsed, search]);

  return (
    <div className="file-selector">
      <input
        className="file-selector-search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search files..."
        autoFocus
      />
      <div className="file-selector-list">
        {visible.map((entry) => {
          const isSelected = selectedPaths.includes(entry.path);
          const isOpen = entry.isDir && !collapsed.has(entry.path);
          return (
            <div
              key={entry.path}
              className={`file-selector-item${isSelected ? " file-selector-item--selected" : ""}`}
              style={{ paddingLeft: search ? 8 : entry.depth * 16 + 8 }}
              onClick={() => {
                if (entry.isDir) {
                  toggleDir(entry.path);
                } else {
                  onToggle(entry.path);
                }
              }}
            >
              {!search && entry.isDir && (
                <span className="file-selector-arrow">
                  {isOpen ? "\u25BE" : "\u25B8"}
                </span>
              )}
              <span className="file-selector-name">
                {entry.isDir ? `\u{1F4C1} ${entry.name}` : entry.name}
              </span>
              {isSelected && <span className="file-selector-check">{"\u2713"}</span>}
            </div>
          );
        })}
        {visible.length === 0 && (
          <div className="file-selector-empty">No files found</div>
        )}
      </div>
    </div>
  );
}
