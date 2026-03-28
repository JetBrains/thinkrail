import type { Session } from "@/types/session.ts";
import type { OpenFile } from "@/store/fileStore.ts";
import { useBoardStore } from "@/store/boardStore.ts";

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
  const openTicketIds = useBoardStore((s) => s.openTicketIds);
  const activeTicketId = useBoardStore((s) => s.activeTicketId);
  const tickets = useBoardStore((s) => s.tickets);
  const activateTicket = useBoardStore((s) => s.activateTicket);
  const closeTicket = useBoardStore((s) => s.closeTicket);
  const showBoard = useBoardStore((s) => s.showBoard);

  const hasPreviewTab = previewFilePath != null && !files.some((f) => f.path === previewFilePath);
  const previewIsActive = hasPreviewTab && !activeFilePath;

  // Board tab is active when no ticket, session, or file is active
  const boardIsActive =
    !activeTicketId && !activeSessionId && !activeFilePath && !previewFilePath;

  const handleSwitchSession = (sid: string) => {
    // Deactivate ticket when switching to a session
    useBoardStore.setState({ activeTicketId: null });
    onSwitchSession(sid);
  };

  const handleSwitchFile = (path: string) => {
    useBoardStore.setState({ activeTicketId: null });
    onSwitchFile(path);
  };

  return (
    <div className="session-tabs">
      {/* Board tab (fixed, always present) */}
      <div
        className={`session-tab board-tab ${boardIsActive ? "session-tab-active" : ""}`}
        onClick={() => showBoard()}
      >
        <span className="session-tab-name">Board</span>
      </div>

      {/* Ticket tabs */}
      {openTicketIds.map((tid) => {
        const t = tickets.get(tid);
        const isActive = tid === activeTicketId;
        return (
          <div
            key={`t-${tid}`}
            className={`session-tab ticket-tab ${isActive ? "session-tab-active" : ""}`}
            onClick={() => activateTicket(tid)}
          >
            <span className="session-tab-name">{t?.title ?? tid.slice(0, 8)}</span>
            <button
              className="session-tab-close"
              onClick={(e) => {
                e.stopPropagation();
                closeTicket(tid);
              }}
            >
              {"\u00D7"}
            </button>
          </div>
        );
      })}

      {/* Separator */}
      {(openTicketIds.length > 0 && (sessions.length > 0 || files.length > 0 || hasPreviewTab)) && (
        <span className="session-tab-sep" />
      )}

      {/* Session tabs */}
      {sessions.map((s) => (
        <div
          key={`s-${s.bonsaiSid}`}
          className={`session-tab ${s.bonsaiSid === activeSessionId && !activeTicketId && !activeFilePath && !previewFilePath ? "session-tab-active" : ""}`}
          onClick={() => handleSwitchSession(s.bonsaiSid)}
        >
          <span
            className="session-tab-dot"
            style={{ background: statusDotColor(s.status) }}
          />
          <span className="session-tab-name">{s.name || s.bonsaiSid.slice(0, 8)}</span>
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
      ))}

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
