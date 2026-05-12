import { useCallback, useState, type ReactNode } from "react";
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

// Panel sizing
const LEFT_DEFAULT = 260;
const RIGHT_DEFAULT = 380;
const LEFT_MIN = 140;
const RIGHT_MIN = 200;
const LEFT_COLLAPSE_THRESHOLD = 100;
const RIGHT_COLLAPSE_THRESHOLD = 150;
const CENTER_MIN = 300;
const COLLAPSED_STRIP_W = 20;
const RESIZE_HANDLE_W = 4;

function Shell({
  onSwitchProject,
  children,
}: {
  onSwitchProject: () => void;
  children: ReactNode;
}) {
  return (
    <div className="app-shell">
      <Header onSwitchProject={onSwitchProject} />
      {children}
    </div>
  );
}

export function AppShell({ onSwitchProject }: { onSwitchProject: () => void }) {
  const projectState = useUiStore((s) => s.projectState);
  const centerView = useUiStore((s) => s.centerView);
  const leftCollapsed = useUiStore((s) => s.leftPanelCollapsed);
  const rightCollapsed = useUiStore((s) => s.rightPanelCollapsed);
  const toggleLeft = useUiStore((s) => s.toggleLeftPanel);
  const toggleRight = useUiStore((s) => s.toggleRightPanel);

  const sessions = useSessionStore((s) => s.sessions);
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const openFilesMap = useFileStore((s) => s.openFiles);
  const activeTicketId = useBoardStore((s) => s.activeTicketId);
  const openTicket = useBoardStore((s) => s.openTicket);

  const activeSession = activeSessionId ? sessions.get(activeSessionId) : null;
  const isNewProjectMode =
    projectState === "new" && !activeSession && openFilesMap.size === 0;
  const isGoalSession =
    (activeSession?.skillId === "new-project" ||
     activeSession?.skillId === "goal-and-requirements") &&
    activeSession.status !== "done" &&
    activeSession.status !== "error";

  const handleOpenTicket = useCallback(
    (ticketId: string) => openTicket(ticketId),
    [openTicket],
  );

  const [leftWidth, setLeftWidth] = useState(LEFT_DEFAULT);
  const [rightWidth, setRightWidth] = useState(RIGHT_DEFAULT);
  const [showSessionManager, setShowSessionManager] = useState(false);

  const handleOpenSessionManager = useCallback(() => {
    setShowSessionManager(true);
  }, []);

  const handleCloseSessionManager = useCallback(() => {
    setShowSessionManager(false);
  }, []);

  const handleLeftResize = useCallback((w: number) => {
    const rightSpace = rightCollapsed ? COLLAPSED_STRIP_W : rightWidth + RESIZE_HANDLE_W;
    const maxLeft = window.innerWidth - rightSpace - CENTER_MIN - RESIZE_HANDLE_W;
    setLeftWidth(Math.min(w, maxLeft));
  }, [rightCollapsed, rightWidth]);

  const handleRightResize = useCallback((w: number) => {
    const leftSpace = leftCollapsed ? COLLAPSED_STRIP_W : leftWidth + RESIZE_HANDLE_W;
    const maxRight = window.innerWidth - leftSpace - CENTER_MIN - RESIZE_HANDLE_W;
    setRightWidth(Math.min(w, maxRight));
  }, [leftCollapsed, leftWidth]);

  // Project state is async — show a loader until validateProject resolves
  // so we don't briefly flash the wrong layout before switching to the
  // new-project flow.
  if (projectState === null) {
    return (
      <Shell onSwitchProject={onSwitchProject}>
        <div className="app-shell-loading">Loading…</div>
      </Shell>
    );
  }

  // Special flows (new-project form, guided goal session) take over the
  // whole window — but only when the user is on Sessions view. Switching
  // to Board always shows the regular workspace layout with the kanban in
  // the center, regardless of the active session.
  if (centerView === "sessions" && isNewProjectMode) {
    return (
      <Shell onSwitchProject={onSwitchProject}>
        <div className="np-fullscreen">
          <NewProjectScreen />
        </div>
      </Shell>
    );
  }

  if (centerView === "sessions" && isGoalSession) {
    return (
      <Shell onSwitchProject={onSwitchProject}>
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
      </Shell>
    );
  }

  return (
    <Shell onSwitchProject={onSwitchProject}>
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
              min={LEFT_MIN}
              collapseThreshold={LEFT_COLLAPSE_THRESHOLD}
            />
          </>
        )}
        <div className="center-panel">
          <ViewModeProvider>
            {showSessionManager ? (
              <>
                <div className="sm-tab-bar">
                  <button className="sm-tab-back" onClick={handleCloseSessionManager}>
                    {"←"} Back to sessions
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
              min={RIGHT_MIN}
              collapseThreshold={RIGHT_COLLAPSE_THRESHOLD}
            />
            <div style={{ width: rightWidth, height: "100%", overflow: "hidden" }}>
              <ContextPanel />
            </div>
          </>
        )}
      </div>
      <StatusBar onOpenSessionManager={handleOpenSessionManager} />
    </Shell>
  );
}
