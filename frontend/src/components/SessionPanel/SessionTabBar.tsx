import type { Session } from "@/types/session.ts";
import type { OpenFile } from "@/store/fileStore.ts";
import { useBoardStore } from "@/store/boardStore.ts";
import { useFileStore } from "@/store/fileStore.ts";

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

function orderSessionsWithHierarchy(sessions: Session[]): Session[] {
  const byParent = new Map<string, Session[]>();
  const roots: Session[] = [];

  for (const s of sessions) {
    if (s.parentBonsaiSid) {
      const children = byParent.get(s.parentBonsaiSid) ?? [];
      children.push(s);
      byParent.set(s.parentBonsaiSid, children);
    } else {
      roots.push(s);
    }
  }

  const result: Session[] = [];
  function addWithChildren(session: Session) {
    result.push(session);
    const children = byParent.get(session.bonsaiSid) ?? [];
    for (const child of children) {
      addWithChildren(child);
    }
  }

  for (const root of roots) {
    addWithChildren(root);
  }
  return result;
}

function nestingDepth(session: Session, allSessions: Session[]): number {
  let depth = 0;
  let current = session;
  while (current.parentBonsaiSid) {
    depth++;
    const parent = allSessions.find((s) => s.bonsaiSid === current.parentBonsaiSid);
    if (!parent) break;
    current = parent;
  }
  return depth;
}

function statusDotColor(status: Session["status"]): string {
  switch (status) {
    case "draft":
      return "var(--gold)";
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
  const activeTicketId = useBoardStore((s) => s.activeTicketId);

  const hasPreviewTab = previewFilePath != null && !files.some((f) => f.path === previewFilePath);
  const previewIsActive = hasPreviewTab && !activeFilePath;

  const handleSwitchSession = (sid: string) => {
    useFileStore.setState({ activeFilePath: null, previewFilePath: null, previewFile: null });
    onSwitchSession(sid);
  };

  const handleSwitchFile = (path: string) => {
    onSwitchFile(path);
  };

  return (
    <div className="session-tabs">
      {/* Session tabs */}
      {orderSessionsWithHierarchy(sessions).map((s) => {
        const depth = nestingDepth(s, sessions);
        const prefix = "\u21B3".repeat(depth);
        const typeIcon = s.subsessionType === "refinement" ? "\u270F\uFE0F " : s.subsessionType === "discussion" ? "\uD83D\uDCAC " : "";
        const hasActiveChild = sessions.some(
          (child) => child.parentBonsaiSid === s.bonsaiSid &&
          child.status !== "done" && child.status !== "error"
        );
        return (
          <div
            key={`s-${s.bonsaiSid}`}
            className={`session-tab ${s.bonsaiSid === activeSessionId && !activeTicketId && !activeFilePath && !previewFilePath ? "session-tab-active" : ""}`}
            style={{ opacity: hasActiveChild ? 0.5 : 1 }}
            onClick={() => handleSwitchSession(s.bonsaiSid)}
          >
            <span
              className="session-tab-dot"
              style={{ background: statusDotColor(s.status) }}
            />
            <span className="session-tab-name">
              {prefix}{hasActiveChild ? "\u23F8 " : ""}{typeIcon}{s.name || s.bonsaiSid.slice(0, 8)}
            </span>
            {s.pendingRequest && (
              <span className="session-tab-badge">
                {s.pendingRequest.type === "question" ? "Q" : "A"}
              </span>
            )}
            <button
              className="session-tab-close"
              onClick={(e) => {
                e.stopPropagation();
                onCloseSession(s.bonsaiSid);
              }}
            >
              {"\u00D7"}
            </button>
          </div>
        );
      })}

      {/* Separator between session tabs and file/preview tabs */}
      {sessions.length > 0 && (files.length > 0 || hasPreviewTab) && (
        <span className="session-tab-sep" />
      )}

      {/* Pinned file tabs */}
      {files.map((f) => (
        <div
          key={`f-${f.path}`}
          className={`session-tab file-tab ${f.path === activeFilePath && !activeTicketId ? "session-tab-active" : ""}`}
          onClick={() => handleSwitchFile(f.path)}
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
          className={`session-tab file-tab file-tab-preview ${previewIsActive && !activeTicketId ? "session-tab-active" : ""}`}
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
