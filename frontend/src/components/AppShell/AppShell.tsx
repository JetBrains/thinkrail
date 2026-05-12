import { useCallback, useState } from "react";
import { Outlet } from "react-router-dom";
import { useUiStore } from "@/store/uiStore.ts";
import { useSessionStore } from "@/store/sessionStore.ts";
import { useFileStore } from "@/store/fileStore.ts";
import { modLabel } from "@/utils/platform.ts";
import { Header } from "./Header.tsx";
import { StatusBar } from "./StatusBar.tsx";
import { LeftPanel } from "./LeftPanel.tsx";
import { ContextPanel } from "@/components/ContextPanel/ContextPanel.tsx";
import { ResizeHandle } from "./ResizeHandle.tsx";
import { SessionPanel } from "@/components/SessionPanel/SessionPanel.tsx";
import { SessionManager } from "@/components/SessionManager/SessionManager.tsx";
import { GoalFilePanel } from "@/components/GoalFilePanel/GoalFilePanel.tsx";
import { NewProjectScreen } from "@/components/SessionPanel/NewProjectScreen.tsx";
import { NewProjectStepper } from "@/components/SessionPanel/NewProjectStepper.tsx";
import { BoardView } from "@/components/BoardView/BoardView.tsx";
import { MetaTicketDetail } from "@/components/MetaTicketDetail/MetaTicketDetail.tsx";
import { useBoardStore } from "@/store/boardStore.ts";
import { ViewModeProvider } from "@/context/ViewModeContext.tsx";
import "@/components/ChatStream/ChatStream.css";
import "@/components/ChatStream/compact.css";
import "./AppShell.css";

const LEFT_DEFAULT = 260;
const RIGHT_DEFAULT = 380;

export function AppShell({ onSwitchProject }: { onSwitchProject: () => void }) {
  const projectState = useUiStore((s) => s.projectState);
  const centerView = useUiStore((s) => s.centerView);
  const sessionsMap = useSessionStore((s) => s.sessions);
  const activeSessionIdAll = useSessionStore((s) => s.activeSessionId);
  const openFilesMap = useFileStore((s) => s.openFiles);
  const activeTicketId = useBoardStore((s) => s.activeTicketId);
  const openTicket = useBoardStore((s) => s.openTicket);
  const handleOpenTicket = useCallback(
    (ticketId: string) => openTicket(ticketId),
    [openTicket],
  );
  const isNewProjectMode =
    projectState === "new" &&
    !(activeSessionIdAll && sessionsMap.get(activeSessionIdAll)) &&
    openFilesMap.size === 0;

  const leftCollapsed = useUiStore((s) => s.leftPanelCollapsed);
  const rightCollapsed = useUiStore((s) => s.rightPanelCollapsed);
  const toggleLeft = useUiStore((s) => s.toggleLeftPanel);
  const toggleRight = useUiStore((s) => s.toggleRightPanel);

  const [leftWidth, setLeftWidth] = useState(LEFT_DEFAULT);
  const [rightWidth, setRightWidth] = useState(RIGHT_DEFAULT);
  const [showSessionManager, setShowSessionManager] = useState(false);

  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const sessions = useSessionStore((s) => s.sessions);
  const activeSession = activeSessionId ? sessions.get(activeSessionId) : null;
  const isGoalSession =
    (activeSession?.skillId === "new-project" ||
     activeSession?.skillId === "goal-and-requirements") &&
    activeSession.status !== "done" &&
    activeSession.status !== "error";

  const handleOpenSessionManager = useCallback(() => {
    setShowSessionManager(true);
  }, []);

  const handleCloseSessionManager = useCallback(() => {
    setShowSessionManager(false);
  }, []);

  const handleLeftResize = useCallback((w: number) => {
    const rightSpace = rightCollapsed ? 20 : rightWidth + 4;
    const maxLeft = window.innerWidth - rightSpace - 300 - 4;
    setLeftWidth(Math.min(w, maxLeft));
  }, [rightCollapsed, rightWidth]);

  const handleRightResize = useCallback((w: number) => {
    const leftSpace = leftCollapsed ? 20 : leftWidth + 4;
    const maxRight = window.innerWidth - leftSpace - 300 - 4;
    setRightWidth(Math.min(w, maxRight));
  }, [leftCollapsed, leftWidth]);

  // Project state is async — show a loader until validateProject resolves
  // so we don't briefly flash the wrong layout before switching to the
  // new-project flow.
  if (projectState === null) {
    return (
      <div className="app-shell">
        <Header onSwitchProject={onSwitchProject} />
        <div className="app-shell-loading">Loading…</div>
      </div>
    );
  }

  // Special flows (new-project form, guided goal session) take over the
  // whole window — but only when the user is on Sessions view. Switching
  // to Board always shows the regular workspace layout with the kanban in
  // the center, regardless of the active session.
  if (centerView === "sessions" && isNewProjectMode) {
    return (
      <div className="app-shell">
        <Header onSwitchProject={onSwitchProject} />
        <div className="np-fullscreen">
          <NewProjectScreen />
        </div>
      </div>
    );
  }

  if (centerView === "sessions" && isGoalSession) {
    return (
      <div className="app-shell">
        <Header onSwitchProject={onSwitchProject} />
        <NewProjectStepper currentStep={2} />
        <div className="layout layout-goal">
          <div className="goal-chat">
            <ViewModeProvider>
              <SessionPanel hideTabBar />
            </ViewModeProvider>
          </div>
          <div className="goal-doc">
            <GoalFilePanel />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <Header onSwitchProject={onSwitchProject} />
      <div className="layout">
        {leftCollapsed ? (
          <button className="left-collapse-btn" onClick={toggleLeft}
            title={`Open left panel (${modLabel("B")})`}>&#9658;</button>
        ) : (
          <>
            <div style={{ width: leftWidth, height: "100%", overflow: "hidden" }}>
              <LeftPanel />
            </div>
            <ResizeHandle
              side="left"
              panelWidth={leftWidth}
              onResize={handleLeftResize}
              onCollapse={toggleLeft}
              min={140}
              collapseThreshold={100}
            />
          </>
        )}
        <div className="center-panel">
          <Outlet />
          <ViewModeProvider>
            {showSessionManager ? (
              <>
                <div className="sm-tab-bar">
                  <button className="sm-tab-back" onClick={handleCloseSessionManager}>
                    {"\u2190"} Back to sessions
                  </button>
                </div>
                <SessionManager onClose={handleCloseSessionManager} />
              </>
            ) : centerView === "board" ? (
              activeTicketId ? (
                <MetaTicketDetail ticketId={activeTicketId} />
              ) : (
                <BoardView onOpenTicket={handleOpenTicket} />
              )
            ) : (
              <SessionPanel />
            )}
          </ViewModeProvider>
        </div>
        {rightCollapsed ? (
          <button className="right-collapse-btn" onClick={toggleRight}
            title={`Open context panel (${modLabel("J")})`}>&#9664;</button>
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
