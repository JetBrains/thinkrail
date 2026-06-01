import { useCallback, useEffect, useRef, useState } from "react";
import { validateProject } from "@/services/project.ts";
import { listDirs, makeDirectory, browseFolder } from "@/services/fs.ts";
import {
  getKnownProjects,
  type KnownProject,
} from "@/services/projects.ts";
import "./ProjectPicker.css";

interface ProjectPickerProps {
  onSelect: (path: string) => void;
  onClose?: () => void;
}

export function ProjectPicker({ onSelect, onClose }: ProjectPickerProps) {
  const [path, setPath] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [dirNotFound, setDirNotFound] = useState(false);
  const [loading, setLoading] = useState(false);
  const [recents, setRecents] = useState<KnownProject[]>([]);
  const [showPasteInput, setShowPasteInput] = useState(false);

  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [highlightIdx, setHighlightIdx] = useState(-1);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getKnownProjects()
      .then(setRecents)
      .catch(() => setRecents([]));
  }, []);

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
        // state="existing" navigates to the workspace too — AppShell
        // renders the detect/onboarding screen there based on the same
        // projectState (see AppShell.tsx).
        onSelect(validateData.path);
      } catch (e) {
        setError((e as Error).message ?? "Cannot reach backend");
      } finally {
        setLoading(false);
      }
    },
    [path, onSelect],
  );

  const openBrowse = useCallback(async () => {
    try {
      const data = await browseFolder();
      if (data?.path) {
        await handleOpen(data.path);
      }
    } catch {
      // user cancelled or backend unreachable; stay on welcome
    }
  }, [handleOpen]);

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
      <div className="picker-welcome" onClick={(e) => e.stopPropagation()}>
        {onClose && (
          <button className="picker-close" onClick={onClose}>{"×"}</button>
        )}

        <div className="picker-hero">
          <svg className="picker-tree" viewBox="0 0 100 110" fill="none" aria-hidden="true">
            <path d="M50 100 V60" stroke="#78350f" strokeWidth="6" strokeLinecap="round"/>
            <path d="M50 70 Q35 65 30 50" stroke="#78350f" strokeWidth="3" strokeLinecap="round"/>
            <path d="M50 65 Q65 60 70 45" stroke="#78350f" strokeWidth="3" strokeLinecap="round"/>
            <ellipse cx="50" cy="35" rx="28" ry="22" fill="#22c55e"/>
            <ellipse cx="30" cy="48" rx="14" ry="10" fill="#16a34a"/>
            <ellipse cx="72" cy="42" rx="14" ry="11" fill="#15803d"/>
            <rect x="32" y="100" width="36" height="6" rx="2" fill="#78350f"/>
          </svg>
          <h1 className="picker-h1">Welcome to Bonsai</h1>
          <p className="picker-tagline">
            Spec-driven development for AI agents. Grow software with intent — one ticket at a time.
          </p>

          <div className="picker-ctas">
            <button
              className="picker-cta picker-cta-primary"
              onClick={openBrowse}
              disabled={loading}
            >
              <span className="picker-cta-h">+ Start a new project</span>
              <span className="picker-cta-s">Idea → Goal &amp; Requirements doc</span>
            </button>
            <button
              className="picker-cta"
              onClick={openBrowse}
              disabled={loading}
            >
              <span className="picker-cta-h">↗ Open an existing project</span>
              <span className="picker-cta-s">Bonsai will investigate the code with you</span>
            </button>
          </div>
        </div>

        {recents.length > 0 && (
          <div className="picker-recents">
            <div className="picker-recents-head">
              <h4 className="picker-recents-label">Recent</h4>
              <div className="picker-recents-rule" />
            </div>
            <div className="picker-recents-list">
              {recents.map((r) => (
                <button
                  key={r.path}
                  className="picker-recent-item"
                  onClick={() => handleOpen(r.path)}
                >
                  <svg className="picker-leaf" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 22V11"/>
                    <path d="M5 11c0-4 3-7 7-7s7 3 7 7c0 4-3 7-7 7s-7-3-7-7Z"/>
                  </svg>
                  <div className="picker-recent-info">
                    <div className="picker-recent-name">{r.name}</div>
                    <div className="picker-recent-path">{r.path}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {!showPasteInput ? (
          <button
            className="picker-paste-toggle"
            onClick={() => {
              setShowPasteInput(true);
              setTimeout(() => inputRef.current?.focus(), 0);
            }}
          >
            Or paste a path to open something not in this list →
          </button>
        ) : (
          <div className="picker-paste-field">
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
            <button
              className="picker-paste-open"
              onClick={() => handleOpen()}
              disabled={loading || !path.trim()}
            >
              {loading ? "Loading…" : "Open"}
            </button>
          </div>
        )}

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
      </div>
    </div>
  );
}
