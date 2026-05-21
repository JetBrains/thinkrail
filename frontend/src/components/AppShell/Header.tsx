import { useState } from "react";
import { useUiStore } from "@/store/uiStore.ts";
import { useSessionStore } from "@/store/sessionStore.ts";
import { useBoardStore } from "@/store/boardStore.ts";
import { useConnectionStore } from "@/store/connectionStore.ts";
import { SettingsModal } from "./SettingsModal.tsx";

export function Header({ onSwitchProject }: { onSwitchProject: () => void }) {
  const projectName = useUiStore((s) => s.projectName);
  const centerView = useUiStore((s) => s.centerView);
  const setCenterView = useUiStore((s) => s.setCenterView);
  const sessions = useSessionStore((s) => s.sessions);
  const activeSessions = Array.from(sessions.values()).filter(
    (s) => s.status === "running",
  );
  const tickets = useBoardStore((s) => s.tickets);
  const ticketCount = tickets.size;

  const handleSelectBoard = () => {
    setCenterView("board");
  };

  const handleSelectSessions = () => {
    setCenterView("sessions");
    useBoardStore.setState({ activeTicketId: null });
  };

  const connectedClients = useConnectionStore((s) => s.clients);
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <>
    <header className="header-bar">
      <div className="header-left">
        <span className="header-logo">Bonsai</span>
        <button className="header-project-btn" onClick={onSwitchProject} title="Switch project">
          {projectName}
        </button>
        <div className="header-view-switcher" role="tablist" aria-label="Center view">
          <button
            type="button"
            role="tab"
            aria-selected={centerView === "board"}
            className={`header-view-btn${centerView === "board" ? " header-view-btn--active" : ""}`}
            onClick={handleSelectBoard}
            title="Show board"
          >
            Board
            {ticketCount > 0 && <span className="header-view-count">{ticketCount}</span>}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={centerView === "sessions"}
            className={`header-view-btn${centerView === "sessions" ? " header-view-btn--active" : ""}`}
            onClick={handleSelectSessions}
            title="Show sessions"
          >
            Sessions
            {activeSessions.length > 0 && (
              <span className="header-view-count header-view-count--live">
                <span className="session-dot" />
                {activeSessions.length}
              </span>
            )}
          </button>
        </div>
        {connectedClients.length > 1 && (
          <span
            className="header-presence"
            title={connectedClients.map((c) => c.displayName).join(", ")}
          >
            {connectedClients.length} connected
          </span>
        )}
      </div>
      <div className="header-right">
        <button
          className="header-settings-btn"
          onClick={() => setSettingsOpen(true)}
          title="Settings"
          aria-label="Settings"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
      </div>
    </header>
    <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </>
  );
}
