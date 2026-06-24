import { useEffect, useRef } from "react";
import { Pencil, MessageCircle, File, X, Folder, Plus } from "lucide-react";
import type { Session } from "@/types/session.ts";
import { SessionStatus, isTerminal } from "@/constants/status.ts";
import type { OpenFile } from "@/store/fileStore.ts";
import { useBoardStore } from "@/store/boardStore.ts";
import { useFileStore } from "@/store/fileStore.ts";
import { useSessionStore } from "@/store/sessionStore.ts";
import { modLabel } from "@/utils/platform.ts";
import { useActiveTabKind } from "./useActiveTabKind.ts";
import { Button } from "@/components/ui/Button";

export interface TicketTab {
  id: string;
  title: string;
}

interface SessionTabBarProps {
  tickets: TicketTab[];
  activeTicketId: string | null;
  onSwitchTicket: (id: string) => void;
  onCloseTicket: (id: string) => void;
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
    if (s.parentThinkrailSid) {
      const children = byParent.get(s.parentThinkrailSid) ?? [];
      children.push(s);
      byParent.set(s.parentThinkrailSid, children);
    } else {
      roots.push(s);
    }
  }

  const result: Session[] = [];
  function addWithChildren(session: Session) {
    result.push(session);
    const children = byParent.get(session.thinkrailSid) ?? [];
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
  while (current.parentThinkrailSid) {
    depth++;
    const parent = allSessions.find((s) => s.thinkrailSid === current.parentThinkrailSid);
    if (!parent) break;
    current = parent;
  }
  return depth;
}

function statusDotColor(status: Session["status"]): string {
  switch (status) {
    case SessionStatus.Draft:
      return "var(--gold)";
    case SessionStatus.Running:
      return "var(--blue)";
    case SessionStatus.Done:
      return "var(--green)";
    case SessionStatus.Error:
      return "var(--red)";
    default:
      return "var(--hint)";
  }
}

export function SessionTabBar({
  tickets,
  activeTicketId,
  onSwitchTicket,
  onCloseTicket,
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
  const createNewSession = useSessionStore((s) => s.createNewSession);
  const kind = useActiveTabKind();

  const hasPreviewTab = previewFilePath != null && !files.some((f) => f.path === previewFilePath);
  const previewIsActive = hasPreviewTab && kind === "file" && !activeFilePath;

  const activeTabRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (kind !== "session" || activeSessionId == null) return;
    activeTabRef.current?.scrollIntoView({ inline: "nearest", block: "nearest" });
  }, [kind, activeSessionId]);

  const handleSwitchSession = (sid: string) => {
    useFileStore.setState({ activeFilePath: null, previewFilePath: null, previewFile: null });
    useBoardStore.setState({ activeTicketId: null });
    onSwitchSession(sid);
  };

  const handleSwitchFile = (path: string) => {
    useBoardStore.setState({ activeTicketId: null });
    onSwitchFile(path);
  };

  return (
    <div className="session-tabs">
      {/* Ticket tabs (ticket = folder) */}
      {tickets.map((t) => {
        const isActive = t.id === activeTicketId && kind === "ticket";
        return (
          <div
            key={`t-${t.id}`}
            className={`session-tab ticket-tab ${isActive ? "session-tab-active" : ""}`}
            onClick={() => onSwitchTicket(t.id)}
          >
            <Folder size={12} strokeWidth={1.5} className="file-tab-icon" />
            <span className="session-tab-name">{t.title}</span>
            <button
              className="session-tab-close"
              onClick={(e) => {
                e.stopPropagation();
                onCloseTicket(t.id);
              }}
            >
              <X size={12} strokeWidth={1.5} />
            </button>
          </div>
        );
      })}

      {/* Separator between ticket tabs and session/file tabs */}
      {tickets.length > 0 && (sessions.length > 0 || files.length > 0 || hasPreviewTab) && (
        <span className="session-tab-sep" />
      )}

      {/* Session tabs */}
      {orderSessionsWithHierarchy(sessions).map((s) => {
        const depth = nestingDepth(s, sessions);
        const prefix = "\u21B3".repeat(depth);
        const hasActiveChild = sessions.some(
          (child) => child.parentThinkrailSid === s.thinkrailSid &&
          !isTerminal(child.status)
        );
        const isActive = s.thinkrailSid === activeSessionId && kind === "session";
        return (
          <div
            key={`s-${s.thinkrailSid}`}
            ref={isActive ? activeTabRef : undefined}
            className={`session-tab ${isActive ? "session-tab-active" : ""}`}
            style={{ opacity: hasActiveChild ? 0.5 : 1 }}
            onClick={() => handleSwitchSession(s.thinkrailSid)}
          >
            <span
              className="session-tab-dot"
              style={{ background: statusDotColor(s.status) }}
            />
            {s.subsessionType === "refinement" && (
              <Pencil size={12} strokeWidth={1.5} className="session-tab-type-icon" />
            )}
            {s.subsessionType === "discussion" && (
              <MessageCircle size={12} strokeWidth={1.5} className="session-tab-type-icon" />
            )}
            <span className="session-tab-name">
              {prefix}{hasActiveChild ? "\u23F8 " : ""}{s.name || s.thinkrailSid.slice(0, 8)}
            </span>
            {s.pendingRequests.length > 0 && (
              <span className="session-tab-badge">
                {s.pendingRequests[0].type === "question" ? "Q" : "A"}
              </span>
            )}
            <button
              className="session-tab-close"
              onClick={(e) => {
                e.stopPropagation();
                onCloseSession(s.thinkrailSid);
              }}
            >
              <X size={12} strokeWidth={1.5} />
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
          className={`session-tab file-tab ${f.path === activeFilePath && kind === "file" ? "session-tab-active" : ""}`}
          onClick={() => handleSwitchFile(f.path)}
        >
          <File size={12} strokeWidth={1.5} className="file-tab-icon" />
          <span className="session-tab-name">{f.name}</span>
          {f.isDirty && <span className="file-tab-dirty">*</span>}
          <button
            className="session-tab-close"
            onClick={(e) => {
              e.stopPropagation();
              onCloseFile(f.path);
            }}
          >
            <X size={12} strokeWidth={1.5} />
          </button>
        </div>
      ))}

      {/* Preview tab (ephemeral, italic) */}
      {hasPreviewTab && (
        <div
          className={`session-tab file-tab file-tab-preview ${previewIsActive ? "session-tab-active" : ""}`}
          onDoubleClick={() => onPinPreview()}
        >
          <File size={12} strokeWidth={1.5} className="file-tab-icon" />
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
            <X size={12} strokeWidth={1.5} />
          </button>
        </div>
      )}

      <div className="session-tabs-spacer" />
      <Button
        variant="primary"
        size="xs"
        onClick={() => createNewSession()}
        title={`New session (${modLabel("T")})`}
      >
        <Plus size={14} strokeWidth={2} />
      </Button>
    </div>
  );
}
