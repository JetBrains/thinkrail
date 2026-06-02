import { useEffect, useMemo, useRef, useState } from "react";
import { useContextMode } from "./useContextMode.ts";
import type { ContextMode } from "./useContextMode.ts";
import { SpecContext } from "./modes/SpecContext.tsx";
import { AgentContext } from "./modes/AgentContext.tsx";
import { CodeContext } from "./modes/CodeContext.tsx";
import { VisTab } from "./modes/VisTab.tsx";
import { PreviewTab } from "./PreviewTab.tsx";
import { PanelCollapseButton } from "@/components/AppShell/PanelCollapseButton.tsx";
import { useSessionStore } from "@/store/sessionStore.ts";
import { useUiStore } from "@/store/uiStore.ts";
import { useBoardStore } from "@/store/boardStore.ts";
import { useTicketRouteStore } from "@/store/ticketRouteStore.ts";
import { TicketPreviewPanel } from "@/components/TicketDetail/TicketPreviewPanel.tsx";
import { useTicketRouteSetPreviewFile } from "./useTicketRouteSetPreviewFile.ts";
import "./ContextPanel.css";

const MODE_CONFIG: Record<ContextMode, { icon: string; label: string }> = {
  spec: { icon: "📋", label: "Spec Context" },
  agent: { icon: "🤖", label: "Agent Context" },
  code: { icon: "📁", label: "Code Context" },
  empty: { icon: "", label: "" },
};

type PinMode = "none" | "dashboard";
type TabId = "context" | "preview";

function ModeContent({ mode, pin }: { mode: ContextMode; pin: PinMode }) {
  if (pin === "dashboard") return <VisTab />;
  switch (mode) {
    case "spec": return <SpecContext />;
    case "agent": return <AgentContext />;
    case "code": return <CodeContext />;
    case "empty": return (
      <div className="context-panel__empty">
        Select a file, spec, or agent session to see context.
      </div>
    );
  }
}

function headerConfig(pin: PinMode, autoMode: ContextMode) {
  if (pin === "dashboard") return { icon: "📊", label: "Dashboard" };
  return MODE_CONFIG[autoMode];
}

/** Ticket-route variant: the right panel becomes the ticket artifact preview. */
function TicketRouteContextPanel() {
  const ticket = useTicketRouteStore((s) => s.ticket);
  const plan = useTicketRouteStore((s) => s.plan);
  const historyEntries = useTicketRouteStore((s) => s.historyEntries);
  const selectedArtifact = useTicketRouteStore((s) => s.selectedArtifact);
  const setSelectedArtifact = useTicketRouteStore((s) => s.setSelectedArtifact);
  const setPlan = useTicketRouteStore((s) => s.setPlan);
  const centerSessionId = useTicketRouteStore((s) => s.centerSessionId);

  // Pull the center session's previewPath + emitted artifacts into the
  // artifact bar so SetPreviewFile output appears without a click.
  const centerSession = useSessionStore(
    (s) => (centerSessionId ? s.sessions.get(centerSessionId) : null),
  );
  const sessionTouchedFiles = useMemo(() => {
    const out: { path: string }[] = [];
    const previewPath = centerSession?.previewPath;
    if (previewPath) out.push({ path: previewPath });
    for (const a of centerSession?.artifacts ?? []) {
      if (out.find((x) => x.path === a.path)) continue;
      out.push({ path: a.path });
    }
    return out;
  }, [centerSession?.previewPath, centerSession?.artifacts]);

  // Keep the right-panel artifact selection in sync with the centre
  // session as the user navigates the phase tree. The hook handles both
  // previewPath changes (agent-driven) and session switches (UI-driven).
  useTicketRouteSetPreviewFile(centerSession ?? null, ticket);

  return (
    <div className="context-panel context-panel--ticket">
      <div className="context-panel__header">
        <PanelCollapseButton side="right" shortcut="J" />
        <span className="context-panel__mode-label">Ticket</span>
      </div>
      <div className="context-panel__body context-panel__body--flush">
        {ticket ? (
          <TicketPreviewPanel
            ticket={ticket}
            plan={plan}
            historyEntries={historyEntries}
            sessionTouchedFiles={sessionTouchedFiles}
            onPlanUpdated={setPlan}
            selectedArtifact={selectedArtifact}
            onSelectArtifact={setSelectedArtifact}
          />
        ) : (
          <div className="context-panel__empty">Loading ticket...</div>
        )}
      </div>
    </div>
  );
}

export function ContextPanel() {
  const centerView = useUiStore((s) => s.centerView);
  const activeTicketId = useBoardStore((s) => s.activeTicketId);
  const inTicketRoute = centerView === "board" && activeTicketId != null;

  const autoMode = useContextMode();
  const [pin, setPin] = useState<PinMode>("none");

  // Preview / artifact state lives per-session in sessionStore. The Preview
  // tab appears whenever the session has either a current focused preview
  // path OR any tracked artifacts.
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const previewPath = useSessionStore(
    (s) => (activeSessionId ? s.sessions.get(activeSessionId)?.previewPath ?? null : null),
  );
  const artifactCount = useSessionStore(
    (s) => (activeSessionId ? s.sessions.get(activeSessionId)?.artifacts.length ?? 0 : 0),
  );
  const previewActive = previewPath != null || artifactCount > 0;

  const [activeTab, setActiveTab] = useState<TabId>("context");
  const lastSeenKey = useRef<string | null>(null);
  useEffect(() => {
    // Re-auto-activate when a new preview path arrives OR when artifacts
    // grow for the first time. Keyed off both so chip-strip-only sessions
    // also surface the tab.
    const key = `${previewPath ?? ""}|${artifactCount}`;
    if (previewActive && key !== lastSeenKey.current) {
      setActiveTab("preview");
      lastSeenKey.current = key;
    }
    if (!previewActive) {
      setActiveTab("context");
      lastSeenKey.current = null;
    }
  }, [previewActive, previewPath, artifactCount]);

  if (inTicketRoute) return <TicketRouteContextPanel />;

  const config = headerConfig(pin, autoMode);
  const showLabel = pin !== "none" || autoMode !== "empty";

  const togglePin = (mode: PinMode) =>
    setPin((prev) => (prev === mode ? "none" : mode));

  return (
    <div className="context-panel">
      <div className="context-panel__header">
        <PanelCollapseButton side="right" shortcut="J" />
        {previewActive ? (
          <div className="context-panel__tabs" role="tablist">
            <button
              role="tab"
              aria-selected={activeTab === "context"}
              className={`context-panel__tab${activeTab === "context" ? " context-panel__tab--active" : ""}`}
              onClick={() => setActiveTab("context")}
            >
              Context
            </button>
            <button
              role="tab"
              aria-selected={activeTab === "preview"}
              className={`context-panel__tab${activeTab === "preview" ? " context-panel__tab--active" : ""}`}
              onClick={() => setActiveTab("preview")}
            >
              Preview
            </button>
          </div>
        ) : showLabel ? (
          <>
            <span className="context-panel__mode-icon">{config.icon}</span>
            <span className="context-panel__mode-label">{config.label}</span>
          </>
        ) : null}
        <button
          className={`context-panel__dash-btn${pin === "dashboard" ? " context-panel__dash-btn--active" : ""}`}
          onClick={() => togglePin("dashboard")}
          title={pin === "dashboard" ? "Back to context" : "Show dashboard"}
        >
          {pin === "dashboard" ? "×" : "📊"}
        </button>
      </div>
      <div className="context-panel__body">
        {previewActive && activeTab === "preview" ? (
          <PreviewTab />
        ) : (
          <ModeContent mode={autoMode} pin={pin} />
        )}
      </div>
    </div>
  );
}
