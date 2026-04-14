import { useState, useEffect, useRef } from "react";
import type { Session } from "@/types/session.ts";
import type { OpenFile } from "@/store/fileStore.ts";
import { useBoardStore } from "@/store/boardStore.ts";
import { useFileStore } from "@/store/fileStore.ts";
import { useSessionStore } from "@/store/sessionStore.ts";

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
  const openTicketIds = useBoardStore((s) => s.openTicketIds);
  const activeTicketId = useBoardStore((s) => s.activeTicketId);
  const tickets = useBoardStore((s) => s.tickets);
  const activateTicket = useBoardStore((s) => s.activateTicket);
  const closeTicket = useBoardStore((s) => s.closeTicket);
  const showBoard = useBoardStore((s) => s.showBoard);
  const updateTicket = useBoardStore((s) => s.updateTicket);
  const deleteTicket = useBoardStore((s) => s.deleteTicket);

  const [ctxMenu, setCtxMenu] = useState<{ tid: string; x: number; y: number } | null>(null);
  const ctxMenuRef = useRef<HTMLDivElement>(null);

  // Close context menu on click outside
  useEffect(() => {
    if (!ctxMenu) return;
    function handleClick(e: MouseEvent) {
      if (ctxMenuRef.current && !ctxMenuRef.current.contains(e.target as Node)) {
        setCtxMenu(null);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [ctxMenu]);

  const hasPreviewTab = previewFilePath != null && !files.some((f) => f.path === previewFilePath);
  const previewIsActive = hasPreviewTab && !activeFilePath;

  // Board tab is active when no ticket, session, or file is active
  const boardIsActive =
    !activeTicketId && !activeSessionId && !activeFilePath && !previewFilePath;

  const handleShowBoard = () => {
    // Clear all active contexts so Board becomes visible
    showBoard();
    useSessionStore.setState({ activeSessionId: null });
    useFileStore.setState({ activeFilePath: null, previewFilePath: null, previewFile: null });
  };

  const handleActivateTicket = (tid: string) => {
    useFileStore.setState({ activeFilePath: null, previewFilePath: null, previewFile: null });
    activateTicket(tid);
  };

  const handleSwitchSession = (sid: string) => {
    useBoardStore.setState({ activeTicketId: null });
    useFileStore.setState({ activeFilePath: null, previewFilePath: null, previewFile: null });
    onSwitchSession(sid);
  };

  const handleSwitchFile = (path: string) => {
    useBoardStore.setState({ activeTicketId: null });
    onSwitchFile(path);
  };

  const handleTicketContextMenu = (e: React.MouseEvent, tid: string) => {
    e.preventDefault();
    setCtxMenu({ tid, x: e.clientX, y: e.clientY });
  };

  const handleRename = async () => {
    if (!ctxMenu) return;
    const t = tickets.get(ctxMenu.tid);
    const newTitle = window.prompt("Rename ticket:", t?.title ?? "");
    if (newTitle && newTitle.trim()) {
      await updateTicket(ctxMenu.tid, { title: newTitle.trim() });
    }
    setCtxMenu(null);
  };

  const handleDelete = async () => {
    if (!ctxMenu) return;
    const t = tickets.get(ctxMenu.tid);
    if (!window.confirm(`Delete ticket "${t?.title ?? ctxMenu.tid}"?`)) {
      setCtxMenu(null);
      return;
    }
    await deleteTicket(ctxMenu.tid);
    setCtxMenu(null);
  };

  return (
    <div className="session-tabs">
      {/* Board tab (fixed, always present) */}
      <div
        className={`session-tab board-tab ${boardIsActive ? "session-tab-active" : ""}`}
        onClick={handleShowBoard}
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
            onClick={() => handleActivateTicket(tid)}
            onContextMenu={(e) => handleTicketContextMenu(e, tid)}
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

      {/* Ticket tab context menu */}
      {ctxMenu && (
        <div
          ref={ctxMenuRef}
          className="ticket-ctx-menu"
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
        >
          <button className="ticket-ctx-menu-item" onClick={handleRename}>
            Rename
          </button>
          <button className="ticket-ctx-menu-item ticket-ctx-menu-item--danger" onClick={handleDelete}>
            Delete
          </button>
        </div>
      )}
    </div>
  );
}
