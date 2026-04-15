import { useCallback, useEffect, useRef, useState } from "react";
import { getRecentProjects, type RecentProject } from "@/services/user.ts";
import { validateProject, initProject } from "@/services/project.ts";
import { listDirs, makeDirectory, browseFolder } from "@/services/fs.ts";
import { useTokenStore } from "@/store/tokenStore.ts";
import "./ProjectPicker.css";

interface ProjectPickerProps {
  onSelect: (path: string, isNew?: boolean) => void;
  onClose?: () => void;
}

export function ProjectPicker({ onSelect, onClose }: ProjectPickerProps) {
  const [path, setPath] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [dirNotFound, setDirNotFound] = useState(false);
  const [loading, setLoading] = useState(false);
  const [recents, setRecents] = useState<RecentProject[]>([]);

  // Autocomplete state
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [highlightIdx, setHighlightIdx] = useState(-1);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Fetch recent projects from backend
  useEffect(() => {
    const token = useTokenStore.getState().token;
    if (!token) return;
    getRecentProjects(token).then((data) => {
      setRecents(data);
      // Auto-open if only one recent and this is the initial picker (no close button)
      if (!onClose && data.length === 1) {
        handleOpen(data[0].path);
      }
    }).catch(() => {
      // Silently fall back to empty list
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debounced autocomplete fetch
  useEffect(() => {
    if (!path || !path.includes("/")) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }
    const timer = setTimeout(async () => {
      const lastSlash = path.lastIndexOf("/");
      const base = path.slice(0, lastSlash + 1);
      const prefix = path.slice(lastSlash + 1);
      try {
        const data = await listDirs(base, prefix);
        const dirs = data.dirs ?? [];
        setSuggestions(dirs);
        setShowSuggestions(dirs.length > 0);
        setHighlightIdx(-1);
      } catch {
        setSuggestions([]);
        setShowSuggestions(false);
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [path]);

  const acceptSuggestion = useCallback((dir: string) => {
    setPath(dir);
    setSuggestions([]);
    setShowSuggestions(false);
    setHighlightIdx(-1);
    inputRef.current?.focus();
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
      setDirNotFound(false);
      setShowSuggestions(false);
      try {
        const validateData = await validateProject(target);
        if (!validateData.exists) {
          setError(`Directory does not exist: ${target}`);
          setDirNotFound(true);
          return;
        }
        if (validateData.valid) {
          onSelect(validateData.path, false);
          return;
        }
        // Not yet initialized — auto-init
        const initData = await initProject(target);
        onSelect(initData.path, true);
      } catch (e) {
        setError((e as Error).message ?? "Cannot reach backend");
      } finally {
        setLoading(false);
      }
    },
    [path, onSelect],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (showSuggestions && suggestions.length > 0) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setHighlightIdx((i) => Math.min(i + 1, suggestions.length - 1));
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setHighlightIdx((i) => Math.max(i - 1, -1));
          return;
        }
        if (e.key === "Tab" || (e.key === "Enter" && highlightIdx >= 0)) {
          e.preventDefault();
          const selected = suggestions[highlightIdx >= 0 ? highlightIdx : 0];
          if (selected) acceptSuggestion(selected);
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          setShowSuggestions(false);
          return;
        }
      }
      if (e.key === "Enter") {
        e.preventDefault();
        handleOpen();
      }
    },
    [handleOpen, showSuggestions, suggestions, highlightIdx, acceptSuggestion],
  );

  return (
    <div className={`picker-container ${onClose ? "picker-modal" : ""}`} onClick={onClose}>
      <div className="picker-card" onClick={(e) => e.stopPropagation()}>
        {onClose && (
          <button className="picker-close" onClick={onClose}>{"\u00D7"}</button>
        )}
        <div className="picker-logo">Bonsai</div>
        <div className="picker-subtitle">
          Specification-driven development workspace
        </div>

        <div className="picker-field" style={{ position: "relative" }}>
          <label className="picker-label">Project Directory</label>
          <div className="picker-input-wrap">
            <input
              ref={inputRef}
              className="picker-input"
              value={path}
              onChange={(e) => {
                setPath(e.target.value);
                setError(null);
                setDirNotFound(false);
              }}
              onKeyDown={handleKeyDown}
              onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
              onFocus={() => { if (suggestions.length > 0) setShowSuggestions(true); }}
              placeholder="/home/user/my-project"
              autoFocus
              autoComplete="off"
            />
            <button
              className="picker-browse-btn"
              title="Browse folders"
              onClick={async () => {
                try {
                  const data = await browseFolder();
                  if (data?.path) {
                    setPath(data.path);
                    setError(null);
                    inputRef.current?.focus();
                  }
                } catch {
                  // ignore
                }
              }}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M1.5 3.5C1.5 2.948 1.948 2.5 2.5 2.5H6.086C6.351 2.5 6.605 2.605 6.793 2.793L7.707 3.707C7.895 3.895 8.149 4 8.414 4H13.5C14.052 4 14.5 4.448 14.5 5V12.5C14.5 13.052 14.052 13.5 13.5 13.5H2.5C1.948 13.5 1.5 13.052 1.5 12.5V3.5Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
              </svg>
            </button>
          </div>
          {showSuggestions && suggestions.length > 0 && (
            <div className="picker-suggestions">
              {suggestions.map((dir, i) => (
                <button
                  key={dir}
                  className={`picker-suggestion ${i === highlightIdx ? "picker-suggestion-active" : ""}`}
                  onMouseDown={() => acceptSuggestion(dir)}
                  onMouseEnter={() => setHighlightIdx(i)}
                >
                  <span className="picker-suggestion-icon">{"\u{1F4C1}"}</span>
                  {dir}
                </button>
              ))}
            </div>
          )}
        </div>

        {error && (
          <div className="picker-error">
            {error}
            {dirNotFound && (
              <button
                className="picker-create-btn"
                onClick={async () => {
                  const target = path.trim();
                  setLoading(true);
                  try {
                    try {
                      await makeDirectory(target);
                      setError(null);
                      setDirNotFound(false);
                      handleOpen(target);
                    } catch (mkErr) {
                      const detail = (mkErr as Error).message ?? "Failed to create directory";
                      const msg = detail.toLowerCase().includes("permission denied")
                        ? `Permission denied: cannot create "${target}". Check folder permissions or choose a different location.`
                        : detail;
                      setError(msg);
                      setDirNotFound(false);
                    }
                  } catch (e) {
                    setError(`Cannot create directory: ${(e as Error).message}`);
                  } finally {
                    setLoading(false);
                  }
                }}
              >
                Create folder
              </button>
            )}
          </div>
        )}

        <div className="picker-actions">
          <button
            className="picker-btn picker-btn-primary"
            onClick={() => handleOpen()}
            disabled={loading || !path.trim()}
          >
            {loading ? "Loading..." : "Open Project"}
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
