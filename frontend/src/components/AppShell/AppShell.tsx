import { useCallback, type ReactNode, useState } from "react";
import { useUiStore } from "@/store/uiStore.ts";
import { modLabel } from "@/utils/platform.ts";
import { Header } from "./Header.tsx";
import { StatusBar } from "./StatusBar.tsx";
import { LeftPanel } from "./LeftPanel.tsx";
import { ResizeHandle } from "./ResizeHandle.tsx";
import { SessionPanel } from "@/components/SessionPanel/SessionPanel.tsx";
import {
  WizardStepper,
  WizardDocPanel,
  WizardDonePanel,
  getWizardConfig,
  stepperFromJourney,
  useWizardLifecycle,
  type WizardConfig,
  type WizardUiPhase,
} from "@/components/Wizard";
import { BoardView } from "@/components/BoardView/BoardView.tsx";
import { BoardTicketPreview } from "@/components/TicketDetail/BoardTicketPreview.tsx";
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
  // Wizard lifecycle owns the "what to render" decision for any
  // wizard-related state (pre-chat / running / done-screen). See
  // useWizardLifecycle.ts — that hook is the only place the projectState
  // + activeSession + outcome + dismissed + centerView combination is
  // resolved into a single rendering decision.
  const lifecycle = useWizardLifecycle();
  const wizardJourney = useUiStore((s) => s.wizardJourney);

  const centerView = useUiStore((s) => s.centerView);
  const leftCollapsed = useUiStore((s) => s.leftPanelCollapsed);
  const rightCollapsed = useUiStore((s) => s.rightPanelCollapsed);
  const toggleLeft = useUiStore((s) => s.toggleLeftPanel);
  const setLeftTab = useUiStore((s) => s.setLeftTab);
  const openTicket = useBoardStore((s) => s.openTicket);
  const previewTicketId = useBoardStore((s) => s.previewTicketId);
  const setPreviewTicket = useBoardStore((s) => s.setPreviewTicket);

  const handleOpenTicket = useCallback(
    (ticketId: string) => openTicket(ticketId),
    [openTicket],
  );

  const [leftWidth, setLeftWidth] = useState(LEFT_DEFAULT);
  const [rightWidth, setRightWidth] = useState(RIGHT_DEFAULT);

  // The kanban board is shown full-width: the left panel is hidden there.
  // Tickets now open as tabs in the Sessions view, so the board is always the
  // kanban (no full-screen ticket route).
  const onBoardView = centerView === "board";
  // On the board, a single-clicked ticket previews in the right panel.
  const showBoardPreview = onBoardView && previewTicketId != null;
  // The app-level right column exists only for the board ticket preview. The
  // sessions view (incl. ticket tabs) hosts its context card inside SessionPanel.
  const hasBoardRight = showBoardPreview;

  const handleOpenSessionManager = useCallback(() => {
    setLeftTab("sessions");
    if (leftCollapsed) toggleLeft();
  }, [setLeftTab, leftCollapsed, toggleLeft]);

  const handleLeftResize = useCallback((w: number) => {
    const rightSpace = !hasBoardRight ? 0 : rightCollapsed ? COLLAPSED_STRIP_W : rightWidth + RESIZE_HANDLE_W;
    const maxLeft = window.innerWidth - rightSpace - CENTER_MIN - RESIZE_HANDLE_W;
    setLeftWidth(Math.min(w, maxLeft));
  }, [hasBoardRight, rightCollapsed, rightWidth]);

  const handleRightResize = useCallback((w: number) => {
    const leftSpace = leftCollapsed ? COLLAPSED_STRIP_W : leftWidth + RESIZE_HANDLE_W;
    const maxRight = window.innerWidth - leftSpace - CENTER_MIN - RESIZE_HANDLE_W;
    setRightWidth(Math.min(w, maxRight));
  }, [leftCollapsed, leftWidth]);

  // ── Wizard branches (driven by useWizardLifecycle) ──────────────────
  // Every branch maps 1:1 to a `WizardLifecycleState.kind`. The hook
  // guarantees only one kind is true at a time, so there's no
  // overlap/precedence to reason about here.

  if (lifecycle.kind === "loading") {
    return (
      <Shell onSwitchProject={onSwitchProject}>
        <div className="app-shell-loading">Loading…</div>
      </Shell>
    );
  }

  if (lifecycle.kind === "pre-chat") {
    const PreChat = lifecycle.chain.preChatComponent;
    return (
      <Shell onSwitchProject={onSwitchProject}>
        <div className="np-fullscreen">
          <PreChat />
        </div>
      </Shell>
    );
  }

  // Prefer the cumulative journey stepper; fall back to the chain-based
  // config when the journey is empty (a session predating it, or the
  // pre-chat preview before any session exists).
  const resolveStepper = (
    sid: string,
    skillId: string | null | undefined,
    phase: WizardUiPhase,
    chainHint: string | null,
  ): WizardConfig | null =>
    stepperFromJourney(wizardJourney, sid, phase) ??
    getWizardConfig(skillId, phase, chainHint ?? undefined);

  if (lifecycle.kind === "done-screen") {
    const wizardConfig = resolveStepper(
      lifecycle.activeSessionId,
      lifecycle.session.skillId,
      "done-screen",
      lifecycle.chainHint,
    );
    return (
      <Shell onSwitchProject={onSwitchProject}>
        {wizardConfig && <WizardStepper steps={wizardConfig.steps} />}
        <WizardDonePanel session={lifecycle.session} outcome={lifecycle.outcome} />
      </Shell>
    );
  }

  if (lifecycle.kind === "running") {
    const wizardConfig = resolveStepper(
      lifecycle.activeSessionId,
      lifecycle.session.skillId,
      "running",
      lifecycle.chainHint,
    );
    if (wizardConfig) {
      return (
        <Shell onSwitchProject={onSwitchProject}>
          <WizardStepper steps={wizardConfig.steps} />
          <div className="layout layout-goal">
            <div className="goal-chat">
              <ViewModeProvider>
                <SessionPanel hideTabBar hideStickyBar hideContextCard />
              </ViewModeProvider>
            </div>
            <div className="goal-doc">
              <WizardDocPanel filePath={wizardConfig.artifactPath} />
            </div>
          </div>
        </Shell>
      );
    }
    // Defensive: if registry doesn't know this skill (shouldn't happen —
    // the lifecycle hook already gated on isWizardSkill), fall through
    // to the regular layout.
  }

  // lifecycle.kind === "none" (or "running" with missing config) → regular layout.
  return (
    <Shell onSwitchProject={onSwitchProject}>
      <div className="layout">
        {onBoardView ? null : leftCollapsed ? (
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
              restColor="var(--panel)"
            />
          </>
        )}
        <div className="center-panel">
          <ViewModeProvider>
            {centerView === "board" ? (
              <BoardView onOpenTicket={handleOpenTicket} onPreviewTicket={setPreviewTicket} />
            ) : (
              <SessionPanel />
            )}
          </ViewModeProvider>
        </div>
        {showBoardPreview && previewTicketId ? (
          <>
            <ResizeHandle
              side="right"
              panelWidth={rightWidth}
              onResize={handleRightResize}
              onCollapse={() => setPreviewTicket(null)}
              min={RIGHT_MIN}
              collapseThreshold={RIGHT_COLLAPSE_THRESHOLD}
            />
            <div className="right-panel-host" style={{ width: rightWidth }}>
              <BoardTicketPreview ticketId={previewTicketId} />
            </div>
          </>
        ) : null}
      </div>
      <StatusBar onOpenSessionManager={handleOpenSessionManager} />
    </Shell>
  );
}
