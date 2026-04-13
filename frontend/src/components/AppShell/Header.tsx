import { useState } from "react";
import { useUiStore } from "@/store/uiStore.ts";
import { useSessionStore } from "@/store/sessionStore.ts";
import { useSettingsStore } from "@/store/settingsStore.ts";
import { useConnectionStore } from "@/store/connectionStore.ts";
import { useTokenStore } from "@/store/tokenStore.ts";
import { useFileStore } from "@/store/fileStore.ts";
import { modLabel } from "@/utils/platform.ts";
import { ThemeSwitcher } from "./ThemeSwitcher.tsx";
import { TokenDialog } from "./TokenDialog.tsx";

const SETTINGS_PATH = ".bonsai/settings.json";

export function Header({ onSwitchProject }: { onSwitchProject: () => void }) {
  const toggleLeft = useUiStore((s) => s.toggleLeftPanel);
  const toggleRight = useUiStore((s) => s.toggleRightPanel);
  const createNewSession = useSessionStore((s) => s.createNewSession);
  const sessions = useSessionStore((s) => s.sessions);
  const activeSessions = Array.from(sessions.values()).filter(
    (s) => s.status === "running",
  );

  const openSettings = async () => {
    await useSettingsStore.getState().ensureFile();
    await useFileStore.getState().openFile(SETTINGS_PATH);
  };

  const connectedClients = useConnectionStore((s) => s.clients);
  const hasToken = useTokenStore((s) => !!s.token);
  const [tokenOpen, setTokenOpen] = useState(false);

  return (
    <>
    <header className="header-bar">
      <div className="header-left">
        <span className="header-logo">Bonsai</span>
        <button className="header-project-btn" onClick={onSwitchProject} title="Switch project">
          {useUiStore((s) => s.projectName)}
        </button>
        <button className="header-btn header-settings-btn" onClick={openSettings} title="Project settings">
          &#9881;
        </button>
        <button
          className={`header-btn${hasToken ? " header-token-active" : ""}`}
          onClick={() => setTokenOpen(true)}
          title={hasToken ? "Token configured" : "Set authentication token"}
        >
          &#128274;
        </button>
        {activeSessions.length > 0 && (
          <span className="header-sessions">
            <span className="session-dot" />
            {activeSessions.length} session
            {activeSessions.length !== 1 ? "s" : ""}
          </span>
        )}
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
    <TokenDialog open={tokenOpen} onClose={() => setTokenOpen(false)} />
    </>
  );
}
