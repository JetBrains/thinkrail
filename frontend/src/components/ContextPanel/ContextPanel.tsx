import { useState } from "react";
import { useContextMode } from "./useContextMode.ts";
import type { ContextMode } from "./useContextMode.ts";
import { SpecContext } from "./modes/SpecContext.tsx";
import { AgentContext } from "./modes/AgentContext.tsx";
import { CodeContext } from "./modes/CodeContext.tsx";
import { VizTab } from "./modes/VizTab.tsx";
import "./ContextPanel.css";

const MODE_CONFIG: Record<ContextMode, { icon: string; label: string }> = {
  spec: { icon: "\uD83D\uDCCB", label: "Spec Context" },
  agent: { icon: "\uD83E\uDD16", label: "Agent Context" },
  code: { icon: "\uD83D\uDCC1", label: "Code Context" },
  empty: { icon: "", label: "" },
};

function ModeContent({ mode, pinDashboard }: { mode: ContextMode; pinDashboard: boolean }) {
  if (pinDashboard) return <VizTab />;
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

export function ContextPanel() {
  const autoMode = useContextMode();
  const [pinDashboard, setPinDashboard] = useState(false);
  const config = pinDashboard
    ? { icon: "\uD83D\uDCCA", label: "Dashboard" }
    : MODE_CONFIG[autoMode];

  return (
    <div className="context-panel">
      <div className="context-panel__header">
        {!pinDashboard && autoMode !== "empty" && (
          <>
            <span className="context-panel__mode-icon">{config.icon}</span>
            <span className="context-panel__mode-label">{config.label}</span>
          </>
        )}
        {pinDashboard && (
          <>
            <span className="context-panel__mode-icon">{config.icon}</span>
            <span className="context-panel__mode-label">{config.label}</span>
          </>
        )}
        <button
          className={`context-panel__dash-btn${pinDashboard ? " context-panel__dash-btn--active" : ""}`}
          onClick={() => setPinDashboard((v) => !v)}
          title={pinDashboard ? "Back to context" : "Show dashboard"}
        >
          {pinDashboard ? "\u00D7" : "\uD83D\uDCCA"}
        </button>
      </div>
      <div className="context-panel__body">
        <ModeContent mode={autoMode} pinDashboard={pinDashboard} />
      </div>
    </div>
  );
}
