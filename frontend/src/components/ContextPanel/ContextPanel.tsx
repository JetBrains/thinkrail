import { useEffect, useMemo, useRef, useState } from "react";
import { FileText, Bot, Folder, type LucideIcon } from "lucide-react";
import { useContextMode } from "./useContextMode.ts";
import type { ContextMode } from "./useContextMode.ts";
import { SpecContext } from "./modes/SpecContext.tsx";
import { AgentContext } from "./modes/AgentContext.tsx";
import { CodeContext } from "./modes/CodeContext.tsx";
import { PreviewTab } from "./PreviewTab.tsx";
import { useSessionStore } from "@/store/sessionStore.ts";
import { useTicketRouteStore } from "@/store/ticketRouteStore.ts";
import { TicketPreviewPanel } from "@/components/TicketDetail/TicketPreviewPanel.tsx";
import { useTicketRouteSetPreviewFile } from "./useTicketRouteSetPreviewFile.ts";
import { Card } from "@/components/ui/index.ts";
import "./ContextPanel.css";

const MODE_CONFIG: Record<ContextMode, { icon: LucideIcon | null; label: string }> = {
  spec: { icon: FileText, label: "Spec Context" },
  agent: { icon: Bot, label: "Agent Context" },
  code: { icon: Folder, label: "Code Context" },
  empty: { icon: null, label: "" },
};

type TabId = "context" | "preview";

function ModeContent({ mode }: { mode: ContextMode }) {
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

/** Ticket-route variant: the right panel becomes the ticket artifact preview. */
export function TicketRouteContextPanel() {
  const ticket = useTicketRouteStore((s) => s.ticket);
  const historyEntries = useTicketRouteStore((s) => s.historyEntries);
  const selectedArtifact = useTicketRouteStore((s) => s.selectedArtifact);
  const setSelectedArtifact = useTicketRouteStore((s) => s.setSelectedArtifact);
  const centerSessionId = useTicketRouteStore((s) => s.centerSessionId);

  // The right panel follows the explicitly-focused session (set by
  // orchestrator/stage/step clicks); with none, it stays empty until one is
  // focused.
  const restoreSession = useSessionStore((s) => s.restoreSession);
  const effectiveCenterSid = centerSessionId;

  // Load the resolved session into memory (no tab) so its artifacts +
  // previewPath are available even before the user opens its session tab.
  // Guarded against duplicate / tight-retry loads per sid.
  const failedRestoreRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const sid = effectiveCenterSid;
    if (!sid) return;
    if (useSessionStore.getState().sessions.has(sid)) return;
    if (failedRestoreRef.current.has(sid)) return;
    let cancelled = false;
    restoreSession(sid, { noTab: true }).catch(() => {
      if (!cancelled) failedRestoreRef.current.add(sid);
    });
    return () => {
      cancelled = true;
    };
  }, [effectiveCenterSid, restoreSession]);

  // Pull the center session's previewPath + emitted artifacts into the
  // artifact bar so SetPreviewFile output appears without a click.
  const centerSession = useSessionStore(
    (s) => (effectiveCenterSid ? s.sessions.get(effectiveCenterSid) ?? null : null),
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
    <Card className="context-panel context-panel--ticket">
      <div className="context-panel__header">
        <span className="context-panel__mode-label">Artifacts</span>
      </div>
      <div className="context-panel__body context-panel__body--flush">
        {ticket ? (
          <TicketPreviewPanel
            ticket={ticket}
            historyEntries={historyEntries}
            sessionTouchedFiles={sessionTouchedFiles}
            selectedArtifact={selectedArtifact}
            onSelectArtifact={setSelectedArtifact}
          />
        ) : (
          <div className="context-panel__empty">Loading ticket...</div>
        )}
      </div>
    </Card>
  );
}

export function ContextPanel() {
  const autoMode = useContextMode();

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

  const config = MODE_CONFIG[autoMode];
  const showLabel = autoMode !== "empty";

  return (
    <Card className="context-panel">
      <div className="context-panel__header">
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
          <span className="context-panel__mode-label">{config.label}</span>
        ) : null}
      </div>
      <div className="context-panel__body">
        {previewActive && activeTab === "preview" ? (
          <PreviewTab />
        ) : (
          <ModeContent mode={autoMode} />
        )}
      </div>
    </Card>
  );
}
