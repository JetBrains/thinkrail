import { useCallback, useEffect, useState } from "react";
import "./ProjectPicker.css";

const STORAGE_KEY = "bonsai-recent-projects";
const API_BASE = import.meta.env.DEV ? "http://localhost:8000" : "";

interface RecentProject {
  path: string;
  name: string;
  lastOpened: number;
}

function getRecents(): RecentProject[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function addRecent(path: string, name: string) {
  const recents = getRecents().filter((r) => r.path !== path);
  recents.unshift({ path, name, lastOpened: Date.now() });
  localStorage.setItem(STORAGE_KEY, JSON.stringify(recents.slice(0, 10)));
}

interface ProjectPickerProps {
  onSelect: (path: string) => void;
}

export function ProjectPicker({ onSelect }: ProjectPickerProps) {
  const [path, setPath] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [recents] = useState(getRecents);

  // Auto-open last project if only one recent
  useEffect(() => {
    if (recents.length === 1) {
      handleOpen(recents[0].path);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleOpen = useCallback(
    async (projectPath?: string) => {
      const target = projectPath ?? path.trim();
      if (!target) {
        setError("Please enter a directory path");
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `${API_BASE}/api/project/validate?path=${encodeURIComponent(target)}`,
        );
        const data = await res.json();
        if (!data.exists) {
          setError(`Directory does not exist: ${target}`);
        } else if (!data.valid) {
          setError(
            `No .specs/registry.json found in ${target}. Use "Create New" to initialize.`,
          );
        } else {
          addRecent(data.path, data.name);
          onSelect(data.path);
        }
      } catch (e) {
        setError(`Cannot reach backend: ${(e as Error).message}`);
      } finally {
        setLoading(false);
      }
    },
    [path, onSelect],
  );

  const handleCreate = useCallback(async () => {
    const target = path.trim();
    if (!target) {
      setError("Please enter a directory path");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/project/init`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: target }),
      });
      const data = await res.json();
      addRecent(data.path, data.name);
      onSelect(data.path);
    } catch (e) {
      setError(`Cannot reach backend: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [path, onSelect]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleOpen();
      }
    },
    [handleOpen],
  );

  return (
    <div className="picker-container">
      <div className="picker-card">
        <div className="picker-logo">Bonsai</div>
        <div className="picker-subtitle">
          Specification-driven development workspace
        </div>

        <div className="picker-field">
          <label className="picker-label">Project Directory</label>
          <input
            className="picker-input"
            value={path}
            onChange={(e) => {
              setPath(e.target.value);
              setError(null);
            }}
            onKeyDown={handleKeyDown}
            placeholder="/home/user/my-project"
            autoFocus
          />
        </div>

        {error && <div className="picker-error">{error}</div>}

        <div className="picker-actions">
          <button
            className="picker-btn picker-btn-primary"
            onClick={() => handleOpen()}
            disabled={loading || !path.trim()}
          >
            {loading ? "Loading..." : "Open Project"}
          </button>
          <button
            className="picker-btn"
            onClick={handleCreate}
            disabled={loading || !path.trim()}
          >
            Create New
          </button>
        </div>

        {recents.length > 0 && (
          <div className="picker-recents">
            <div className="picker-recents-label">Recent Projects</div>
            {recents.map((r) => (
              <button
                key={r.path}
                className="picker-recent-item"
                onClick={() => handleOpen(r.path)}
              >
                <span className="picker-recent-name">{r.name}</span>
                <span className="picker-recent-path">{r.path}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
