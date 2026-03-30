import { useUiStore } from "@/store/uiStore.ts";
import { useSessionStore } from "@/store/sessionStore.ts";
import { modLabel } from "@/utils/platform.ts";
import { ThemeSwitcher } from "./ThemeSwitcher.tsx";

export function Header({ onSwitchProject }: { onSwitchProject: () => void }) {
  const toggleLeft = useUiStore((s) => s.toggleLeftPanel);
  const toggleRight = useUiStore((s) => s.toggleRightPanel);
  const createNewSession = useSessionStore((s) => s.createNewSession);
  const sessions = useSessionStore((s) => s.sessions);
  const activeSessions = Array.from(sessions.values()).filter(
    (s) => s.status === "running",
  );

  return (
    <header className="header-bar">
      <div className="header-left">
        <span className="header-logo">Bonsai</span>
        <button className="header-project-btn" onClick={onSwitchProject} title="Switch project">
          {useUiStore((s) => s.projectName)}
        </button>
        {activeSessions.length > 0 && (
          <span className="header-sessions">
            <span className="session-dot" />
            {activeSessions.length} session
            {activeSessions.length !== 1 ? "s" : ""}
          </span>
        )}
      </div>
      <div className="header-right">
        <button className="header-btn" onClick={() => toggleLeft()} title={`Toggle tree (${modLabel("B")})`}>
          Tree
        </button>
        <button className="header-btn" onClick={() => toggleRight()} title={`Toggle context panel (${modLabel("J")})`}>
          Context
        </button>
        <ThemeSwitcher />
        <button className="header-btn header-btn-primary" onClick={() => createNewSession()} title={`New session (${modLabel("T")})`}>
          + New
        </button>
      </div>
    </header>
  );
}
