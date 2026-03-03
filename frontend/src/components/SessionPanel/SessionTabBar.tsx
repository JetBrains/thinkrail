import type { Session } from "@/types/session.ts";

interface SessionTabBarProps {
  sessions: Session[];
  activeId: string | null;
  onSwitch: (taskId: string) => void;
  onClose: (taskId: string) => void;
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
  activeId,
  onSwitch,
  onClose,
}: SessionTabBarProps) {
  if (sessions.length === 0) return null;

  return (
    <div className="session-tabs">
      {sessions.map((s) => (
        <div
          key={s.taskId}
          className={`session-tab ${s.taskId === activeId ? "session-tab-active" : ""}`}
          onClick={() => onSwitch(s.taskId)}
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
              onClose(s.taskId);
            }}
          >
            {"\u00D7"}
          </button>
        </div>
      ))}
    </div>
  );
}
