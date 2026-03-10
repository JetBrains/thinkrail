import { useState } from "react";
import { useSessionStore } from "@/store/sessionStore.ts";
import { useContextMode } from "./useContextMode.ts";
import type { ContextMode } from "./useContextMode.ts";
import { SpecContext } from "./modes/SpecContext.tsx";
import { AgentContext } from "./modes/AgentContext.tsx";
import { CodeContext } from "./modes/CodeContext.tsx";
import { VizTab } from "./modes/VizTab.tsx";
import { ContextTab } from "./modes/ContextTab.tsx";
import "./ContextPanel.css";

const MODE_CONFIG: Record<ContextMode, { icon: string; label: string }> = {
  spec: { icon: "\uD83D\uDCCB", label: "Spec Context" },
  agent: { icon: "\uD83E\uDD16", label: "Agent Context" },
  code: { icon: "\uD83D\uDCC1", label: "Code Context" },
  empty: { icon: "", label: "" },
};

type PinMode = "none" | "dashboard" | "context";

function ModeContent({ mode, pin }: { mode: ContextMode; pin: PinMode }) {
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  if (pin === "context") return <ContextTab key={activeSessionId ?? "none"} />;
  if (pin === "dashboard") return <VizTab />;
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
  if (pin === "context") return { icon: "\uD83D\uDCCF", label: "Context" };
  if (pin === "dashboard") return { icon: "\uD83D\uDCCA", label: "Dashboard" };
  return MODE_CONFIG[autoMode];
}

export function ContextPanel() {
  const autoMode = useContextMode();
  const [pin, setPin] = useState<PinMode>("none");
  const config = headerConfig(pin, autoMode);
  const showLabel = pin !== "none" || autoMode !== "empty";

  const togglePin = (mode: PinMode) =>
    setPin((prev) => (prev === mode ? "none" : mode));

  return (
    <div className="context-panel">
      <div className="context-panel__header">
        {showLabel && (
          <>
            <span className="context-panel__mode-icon">{config.icon}</span>
            <span className="context-panel__mode-label">{config.label}</span>
          </>
        )}
        <button
          className={`context-panel__dash-btn${pin === "context" ? " context-panel__dash-btn--active" : ""}`}
          onClick={() => togglePin("context")}
          title={pin === "context" ? "Back to context" : "Show context usage"}
        >
          {pin === "context" ? "\u00D7" : "Ctx"}
        </button>
        <button
          className={`context-panel__dash-btn${pin === "dashboard" ? " context-panel__dash-btn--active" : ""}`}
          onClick={() => togglePin("dashboard")}
          title={pin === "dashboard" ? "Back to context" : "Show dashboard"}
        >
          {pin === "dashboard" ? "\u00D7" : "\uD83D\uDCCA"}
        </button>
      </div>
      <div className="context-panel__body">
        <ModeContent mode={autoMode} pin={pin} />
      </div>
    </div>
  );
}
