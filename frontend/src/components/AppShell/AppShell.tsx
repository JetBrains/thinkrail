import { useCallback, useState } from "react";
import { Outlet } from "react-router-dom";
import { useUiStore } from "@/store/uiStore.ts";
import { Header } from "./Header.tsx";
import { StatusBar } from "./StatusBar.tsx";
import { LeftPanel } from "./LeftPanel.tsx";
import { ContextPanel } from "@/components/ContextPanel/ContextPanel.tsx";
import { ResizeHandle } from "./ResizeHandle.tsx";
import { SessionPanel } from "@/components/SessionPanel/SessionPanel.tsx";
import { SessionManager } from "@/components/SessionManager/SessionManager.tsx";
import "@/components/ChatStream/ChatStream.css";
import "./AppShell.css";

const LEFT_DEFAULT = 260;
const RIGHT_DEFAULT = 380;

export function AppShell({ onSwitchProject }: { onSwitchProject: () => void }) {
  const leftCollapsed = useUiStore((s) => s.leftPanelCollapsed);
  const rightCollapsed = useUiStore((s) => s.rightPanelCollapsed);
  const toggleLeft = useUiStore((s) => s.toggleLeftPanel);
  const toggleRight = useUiStore((s) => s.toggleRightPanel);

  const [leftWidth, setLeftWidth] = useState(LEFT_DEFAULT);
  const [rightWidth, setRightWidth] = useState(RIGHT_DEFAULT);
  const [showSessionManager, setShowSessionManager] = useState(false);

  const handleOpenSessionManager = useCallback(() => {
    setShowSessionManager(true);
  }, []);

  const handleCloseSessionManager = useCallback(() => {
    setShowSessionManager(false);
  }, []);

  const handleRightResize = useCallback((w: number) => {
    const leftSpace = leftCollapsed ? 0 : leftWidth + 4;
    const maxRight = window.innerWidth - leftSpace - 300 - 4;
    setRightWidth(Math.min(w, maxRight));
  }, [leftCollapsed, leftWidth]);

  return (
    <div className="app-shell">
      <Header onSwitchProject={onSwitchProject} />
      <div className="layout">
        {!leftCollapsed && (
          <>
            <div style={{ width: leftWidth, height: "100%", overflow: "hidden" }}>
              <LeftPanel />
            </div>
            <ResizeHandle
              side="left"
              panelWidth={leftWidth}
              onResize={setLeftWidth}
              onCollapse={toggleLeft}
              min={140}
              max={420}
              collapseThreshold={100}
            />
          </>
        )}
        <div className="center-panel">
          <Outlet />
          {showSessionManager ? (
            <>
              <div className="sm-tab-bar">
                <button className="sm-tab-back" onClick={handleCloseSessionManager}>
                  {"\u2190"} Back to sessions
                </button>
              </div>
              <SessionManager onClose={handleCloseSessionManager} />
            </>
          ) : (
            <SessionPanel />
          )}
        </div>
        {rightCollapsed ? (
          <button className="right-collapse-btn" onClick={toggleRight}
            title="Open context panel (Cmd+J)">&#9664;</button>
        ) : (
          <>
            <ResizeHandle
              side="right"
              panelWidth={rightWidth}
              onResize={handleRightResize}
              onCollapse={toggleRight}
              min={200}
              collapseThreshold={150}
            />
            <div style={{ width: rightWidth, height: "100%", overflow: "hidden" }}>
              <ContextPanel />
            </div>
          </>
        )}
      </div>
      <StatusBar onOpenSessionManager={handleOpenSessionManager} />
    </div>
  );
}
