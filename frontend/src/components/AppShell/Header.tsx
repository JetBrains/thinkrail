import { useUiStore } from "@/store/uiStore.ts";
import { useSessionStore } from "@/store/sessionStore.ts";

export function Header() {
  const toggleLeft = useUiStore((s) => s.toggleLeftPanel);
  const openModal = useUiStore((s) => s.openModal);
  const sessions = useSessionStore((s) => s.sessions);
  const activeSessions = Array.from(sessions.values()).filter(
    (s) => s.status === "running",
  );

  return (
    <header className="header-bar">
      <div className="header-left">
        <span className="header-logo">Bonsai</span>
        <span className="header-project">{useUiStore((s) => s.projectName)}</span>
        {activeSessions.length > 0 && (
          <span className="header-sessions">
            <span className="session-dot" />
            {activeSessions.length} session
            {activeSessions.length !== 1 ? "s" : ""}
          </span>
        )}
      </div>
      <div className="header-right">
        <button className="header-btn" onClick={() => toggleLeft()} title="Toggle tree (Ctrl+B)">
          Tree
        </button>
        <button className="header-btn header-btn-primary" onClick={() => openModal()} title="New session (Cmd+T)">
          + New
        </button>
      </div>
    </header>
  );
}
