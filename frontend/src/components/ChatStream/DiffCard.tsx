import { useState, useRef, useEffect, useCallback } from "react";
import { DiffEditor, type DiffOnMount } from "@monaco-editor/react";
import { detectLanguage, languageLabel } from "@/components/FileViewer/languageMap.ts";
import { intellijDarcula } from "@/components/FileViewer/intellijTheme.ts";
import "./DiffCard.css";

const THEME_NAME = "intellij-darcula";

const TOOL_ICONS: Record<string, string> = {
  Edit: "\u270F\uFE0F",
  Write: "\u270F\uFE0F",
  NotebookEdit: "\u{1F4D3}",
};

/** Binary-ish extensions where diff doesn't make sense. */
const BINARY_EXTS = new Set([
  "png", "jpg", "jpeg", "gif", "bmp", "ico", "webp", "svg",
  "woff", "woff2", "ttf", "eot", "otf",
  "zip", "gz", "tar", "bz2", "7z", "rar",
  "pdf", "doc", "docx", "xls", "xlsx",
  "exe", "dll", "so", "dylib", "bin",
  "mp3", "mp4", "wav", "avi", "mov", "mkv",
]);

const LARGE_FILE_THRESHOLD = 100_000; // 100KB

type CardState = "running" | "success" | "error";

interface DiffCardProps {
  toolName: string;
  toolInput: Record<string, unknown>;
  output?: string;
  isError?: boolean;
  state: CardState;
  compact?: boolean;
}

interface DiffData {
  filePath: string;
  original: string;
  modified: string;
}

function extractDiffData(toolName: string, toolInput: Record<string, unknown>): DiffData | null {
  switch (toolName) {
    case "Edit": {
      const filePath = (toolInput.file_path as string) ?? "";
      const oldStr = (toolInput.old_string as string) ?? "";
      const newStr = (toolInput.new_string as string) ?? "";
      if (!filePath || (!oldStr && !newStr)) return null;
      return { filePath, original: oldStr, modified: newStr };
    }
    case "Write": {
      const filePath = (toolInput.file_path as string) ?? "";
      const content = (toolInput.content as string) ?? "";
      const prev = (toolInput._previousContent as string) ?? "";
      if (!filePath) return null;
      return { filePath, original: prev, modified: content };
    }
    case "NotebookEdit": {
      const filePath = (toolInput.notebook_path as string) ?? "";
      const oldSource = (toolInput.old_source as string) ?? "";
      const newSource = (toolInput.new_source as string) ?? (toolInput.source as string) ?? "";
      if (!filePath) return null;
      return { filePath, original: oldSource, modified: newSource };
    }
    default:
      return null;
  }
}

function computeStats(original: string, modified: string): { added: number; removed: number } {
  const origLines = original ? original.split("\n") : [];
  const modLines = modified ? modified.split("\n") : [];
  const origSet = new Set(origLines);
  const modSet = new Set(modLines);
  let added = 0;
  let removed = 0;
  for (const line of modLines) {
    if (!origSet.has(line)) added++;
  }
  for (const line of origLines) {
    if (!modSet.has(line)) removed++;
  }
  return { added, removed };
}

function isBinaryFile(filePath: string): boolean {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  return BINARY_EXTS.has(ext);
}

function truncatePath(filePath: string, maxLen = 50): string {
  if (filePath.length <= maxLen) return filePath;
  const parts = filePath.split("/");
  const filename = parts.pop() ?? filePath;
  if (filename.length >= maxLen) return "..." + filename.slice(-maxLen + 3);
  const remaining = maxLen - filename.length - 4; // ".../"
  const dirPart = parts.join("/");
  return "..." + dirPart.slice(-remaining) + "/" + filename;
}

export function DiffCard({
  toolName,
  toolInput,
  output,
  isError,
  state,
  compact = false,
}: DiffCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [forceLoadLarge, setForceLoadLarge] = useState(false);
  const [editorHeight, setEditorHeight] = useState(compact ? 200 : 300);
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const themeRegistered = useRef(false);

  const diffData = extractDiffData(toolName, toolInput);

  // ResizeObserver to sync container height → Monaco height
  useEffect(() => {
    const el = editorContainerRef.current;
    if (!el || !expanded) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setEditorHeight(entry.contentRect.height);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [expanded]);

  const handleMount: DiffOnMount = useCallback((_editor, monaco) => {
    if (!themeRegistered.current) {
      monaco.editor.defineTheme(THEME_NAME, intellijDarcula);
      themeRegistered.current = true;
    }
    monaco.editor.setTheme(THEME_NAME);
  }, []);

  const borderColor =
    state === "running"
      ? "var(--blue)"
      : isError
        ? "var(--red)"
        : "var(--green)";

  const statusText =
    state === "running"
      ? "running..."
      : isError
        ? "error"
        : "done";

  const statusIcon =
    state === "running" ? "\u25CF" : isError ? "\u2715" : "\u2713";

  // Fallback: binary file or missing diff data
  if (!diffData || isBinaryFile(diffData.filePath)) {
    return (
      <div className={`diff-card${compact ? " diff-card--compact" : ""}`} style={{ borderLeftColor: borderColor }}>
        <div className="diff-card-header" onClick={() => setExpanded(!expanded)}>
          <span className="diff-card-icon">{TOOL_ICONS[toolName] ?? "\u{1F527}"}</span>
          <span className="diff-card-name">{toolName}</span>
          {diffData && <span className="diff-card-path">{truncatePath(diffData.filePath)}</span>}
          <span className="diff-card-status" style={{ color: borderColor }}>
            {statusIcon} {statusText}
          </span>
        </div>
        {expanded && (
          <div className="diff-card-fallback">
            <pre>{diffData ? `Binary file: ${diffData.filePath}` : JSON.stringify(toolInput, null, 2)}</pre>
          </div>
        )}
      </div>
    );
  }

  const { filePath, original, modified } = diffData;
  const lang = detectLanguage(filePath);
  const langLabel = languageLabel(filePath);
  const stats = computeStats(original, modified);
  const isLargeFile = (original.length + modified.length) > LARGE_FILE_THRESHOLD;

  return (
    <div className={`diff-card${compact ? " diff-card--compact" : ""}`} style={{ borderLeftColor: borderColor }}>
      <div className="diff-card-header" onClick={() => setExpanded(!expanded)}>
        <span className="diff-card-icon">{TOOL_ICONS[toolName] ?? "\u{1F527}"}</span>
        <span className="diff-card-name">{toolName}</span>
        <span className="diff-card-path">{truncatePath(filePath)}</span>
        <span className="diff-card-lang">{langLabel}</span>
        <span className="diff-card-stats">
          {stats.added > 0 && <span className="diff-card-stats-add">+{stats.added}</span>}
          {stats.removed > 0 && <span className="diff-card-stats-del">-{stats.removed}</span>}
        </span>
        <span className="diff-card-status" style={{ color: borderColor }}>
          {statusIcon} {statusText}
        </span>
      </div>
      {expanded && (
        <>
          {isLargeFile && !forceLoadLarge ? (
            <div className="diff-card-large-warning">
              <p style={{ color: "var(--muted)", fontSize: 12, margin: "0 0 8px" }}>
                Large file ({Math.round((original.length + modified.length) / 1024)}KB) — loading the diff editor may be slow.
              </p>
              <button onClick={() => setForceLoadLarge(true)}>Load diff anyway</button>
            </div>
          ) : (
            <div className="diff-card-editor-scroll">
              <div
                className="diff-card-editor"
                ref={editorContainerRef}
              >
                <DiffEditor
                  original={original}
                  modified={modified}
                  language={lang}
                  theme={THEME_NAME}
                  height={editorHeight}
                  loading={<div className="diff-loading">Loading diff editor...</div>}
                  beforeMount={(monaco) => {
                    if (!themeRegistered.current) {
                      monaco.editor.defineTheme(THEME_NAME, intellijDarcula);
                      themeRegistered.current = true;
                    }
                  }}
                  onMount={handleMount}
                  options={{
                    readOnly: true,
                    renderSideBySide: true,
                    minimap: { enabled: false },
                    scrollBeyondLastLine: false,
                    fontSize: 12,
                    fontFamily: "'JetBrains Mono', 'Fira Code', 'SF Mono', monospace",
                    lineNumbers: "on",
                    automaticLayout: true,
                    enableSplitViewResizing: true,
                    ignoreTrimWhitespace: false,
                  }}
                />
              </div>
            </div>
          )}
          {isError && output && (
            <div className="diff-card-error">
              <pre>{output}</pre>
            </div>
          )}
        </>
      )}
    </div>
  );
}
