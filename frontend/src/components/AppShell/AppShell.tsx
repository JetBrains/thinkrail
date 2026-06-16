import { useCallback, type ReactNode, useState } from "react";
import { useUiStore } from "@/store/uiStore.ts";
import { useDraftFlushOnHide } from "@/hooks/useDraftFlushOnHide.ts";
import { modLabel } from "@/utils/platform.ts";
import { Header } from "./Header.tsx";
import { LeftPanel } from "./LeftPanel.tsx";
import { ResizeHandle } from "./ResizeHandle.tsx";
import { SessionPanel } from "@/components/SessionPanel/SessionPanel.tsx";
import { SessionsLeftPanel } from "@/components/SessionPanel/SessionsLeftPanel.tsx";
import { SessionsViewLayout } from "@/components/SessionPanel/SessionsViewLayout.tsx";
import {
  WizardDonePanel,
  getWizardConfig,
  stepperFromJourney,
  useWizardLifecycle,
  type WizardConfig,
  type WizardUiPhase,
} from "@/components/Wizard";
import { BoardView } from "@/components/BoardView/BoardView.tsx";
import { useBoardStore } from "@/store/boardStore.ts";
import { ViewModeProvider } from "@/context/ViewModeContext.tsx";
import "@/components/ChatStream/ChatStream.css";
import "@/components/ChatStream/compact.css";
import "./AppShell.css";

// Panel sizing
const LEFT_DEFAULT = 260;
const LEFT_MIN = 140;
const LEFT_COLLAPSE_THRESHOLD = 100;
const CENTER_MIN = 300;
const RESIZE_HANDLE_W = 4;

function Shell({
  onSwitchProject,
  children,
  wizardSteps,
}: {
  onSwitchProject: () => void;
  children: ReactNode;
  wizardSteps?: WizardConfig | null;
}) {
  return (
    <div className="app-shell">
      <Header
        onSwitchProject={onSwitchProject}
        variant={wizardSteps ? "wizard" : "default"}
        wizardSteps={wizardSteps?.steps}
      />
      {children}
    </div>
  );
}

export function AppShell({ onSwitchProject }: { onSwitchProject: () => void }) {
  useDraftFlushOnHide();

  // Wizard lifecycle owns the "what to render" decision for any
  // wizard-related state (pre-chat / running / done-screen). See
  // useWizardLifecycle.ts — that hook is the only place the projectState
  // + activeSession + outcome + dismissed + centerView combination is
  // resolved into a single rendering decision.
  const lifecycle = useWizardLifecycle();
  const wizardJourney = useUiStore((s) => s.wizardJourney);

  const centerView = useUiStore((s) => s.centerView);
  const leftCollapsed = useUiStore((s) => s.leftPanelCollapsed);
  const toggleLeft = useUiStore((s) => s.toggleLeftPanel);
  const openTicket = useBoardStore((s) => s.openTicket);
  const setPreviewTicket = useBoardStore((s) => s.setPreviewTicket);

  const handleOpenTicket = useCallback(
    (ticketId: string) => openTicket(ticketId),
    [openTicket],
  );

  const [leftWidth, setLeftWidth] = useState(LEFT_DEFAULT);

  const onBoardView = centerView === "board";

  const handleLeftResize = useCallback((w: number) => {
    const maxLeft = window.innerWidth - CENTER_MIN - RESIZE_HANDLE_W;
    setLeftWidth(Math.min(w, maxLeft));
  }, []);

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
    const wizardConfig = getWizardConfig(lifecycle.chain.id, "pre-chat");
    return (
      <Shell onSwitchProject={onSwitchProject} wizardSteps={wizardConfig}>
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
      <Shell onSwitchProject={onSwitchProject} wizardSteps={wizardConfig}>
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
        <Shell onSwitchProject={onSwitchProject} wizardSteps={wizardConfig}>
          <ViewModeProvider>
            <SessionsViewLayout
              leftPanel={<SessionsLeftPanel />}
              mainContent={<SessionPanel />}
            />
          </ViewModeProvider>
        </Shell>
      );
    }
    // Defensive: if registry doesn't know this skill (shouldn't happen —
    // the lifecycle hook already gated on isWizardSkill), fall through
    // to the regular layout.
  }

  // lifecycle.kind === "none" (or "running" with missing config) → regular layout.
  const onSessionsView = centerView === "sessions";

  // Sessions view uses island layout with sphere background
  if (onSessionsView) {
    return (
      <Shell onSwitchProject={onSwitchProject}>
        <ViewModeProvider>
          <SessionsViewLayout
            leftPanel={<SessionsLeftPanel />}
            mainContent={<SessionPanel />}
          />
        </ViewModeProvider>
      </Shell>
    );
  }

  // Board and other views use regular layout
  return (
    <Shell onSwitchProject={onSwitchProject}>
      <div className="layout">
        {/* Board view: no left panel */}
        {onBoardView ? null : (
          /* Other views: show regular LeftPanel */
          leftCollapsed ? (
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
                restColor="var(--elevated)"
              />
            </>
          )
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
      </div>
    </Shell>
  );
}
