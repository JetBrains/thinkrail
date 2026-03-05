import type { Session } from "@/types/session.ts";
import type { OpenFile } from "@/store/fileStore.ts";

interface SessionTabBarProps {
  sessions: Session[];
  activeSessionId: string | null;
  onSwitchSession: (taskId: string) => void;
  onCloseSession: (taskId: string) => void;
  files: OpenFile[];
  activeFilePath: string | null;
  onSwitchFile: (path: string) => void;
  onCloseFile: (path: string) => void;
  previewFile: OpenFile | null;
  previewFilePath: string | null;
  onClearPreview: () => void;
  onPinPreview: () => void;
}

function statusDotColor(status: Session["status"]): string {
  switch (status) {
    case "running":
      return "var(--blue)";
    case "done":
      return "var(--green)";
    case "error":
      return "var(--red)";
    default:
      return "var(--hint)";
  }
}

export function SessionTabBar({
  sessions,
  activeSessionId,
  onSwitchSession,
  onCloseSession,
  files,
  activeFilePath,
  onSwitchFile,
  onCloseFile,
  previewFile,
  previewFilePath,
  onClearPreview,
  onPinPreview,
}: SessionTabBarProps) {
  const hasPreviewTab = previewFilePath != null && !files.some((f) => f.path === previewFilePath);
  const hasFileArea = files.length > 0 || hasPreviewTab;
  const previewIsActive = hasPreviewTab && !activeFilePath;

  if (sessions.length === 0 && !hasFileArea) return null;

  return (
    <div className="session-tabs">
      {/* Session tabs */}
      {sessions.map((s) => (
        <div
          key={`s-${s.taskId}`}
          className={`session-tab ${s.taskId === activeSessionId && !activeFilePath && !previewFilePath ? "session-tab-active" : ""}`}
          onClick={() => onSwitchSession(s.taskId)}
        >
          <span
            className="session-tab-dot"
            style={{ background: statusDotColor(s.status) }}
          />
          <span className="session-tab-name">{s.name || s.taskId.slice(0, 8)}</span>
          {s.pendingRequest && (
            <span className="session-tab-badge">
              {s.pendingRequest.type === "question" ? "Q" : "A"}
            </span>
          )}
          <button
            className="session-tab-close"
            onClick={(e) => {
              e.stopPropagation();
              onCloseSession(s.taskId);
            }}
          >
            {"\u00D7"}
          </button>
        </div>
      ))}

      {/* Separator between session tabs and file/preview tabs */}
      {sessions.length > 0 && hasFileArea && (
        <span className="session-tab-sep" />
      )}

      {/* Pinned file tabs */}
      {files.map((f) => (
        <div
          key={`f-${f.path}`}
          className={`session-tab file-tab ${f.path === activeFilePath ? "session-tab-active" : ""}`}
          onClick={() => onSwitchFile(f.path)}
        >
          <span className="file-tab-icon">{"\u{1F4C4}"}</span>
          <span className="session-tab-name">{f.name}</span>
          {f.isDirty && <span className="file-tab-dirty">{"\u25CF"}</span>}
          <button
            className="session-tab-close"
            onClick={(e) => {
              e.stopPropagation();
              onCloseFile(f.path);
            }}
          >
            {"\u00D7"}
          </button>
        </div>
      ))}

      {/* Preview tab (ephemeral, italic) */}
      {hasPreviewTab && (
        <div
          className={`session-tab file-tab file-tab-preview ${previewIsActive ? "session-tab-active" : ""}`}
          onDoubleClick={() => onPinPreview()}
        >
          <span className="file-tab-icon">{"\u{1F4C4}"}</span>
          <span className="session-tab-name">
            {previewFile?.name ?? previewFilePath!.split("/").pop()}
          </span>
          <button
            className="session-tab-close"
            onClick={(e) => {
              e.stopPropagation();
              onClearPreview();
            }}
          >
            {"\u00D7"}
          </button>
        </div>
      )}
    </div>
  );
}
