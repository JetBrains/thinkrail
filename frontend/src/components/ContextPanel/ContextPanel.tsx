import { useContextMode } from "./useContextMode.ts";
import type { ContextMode } from "./useContextMode.ts";
import { SpecContext } from "./modes/SpecContext.tsx";
import { AgentContext } from "./modes/AgentContext.tsx";
import { CodeContext } from "./modes/CodeContext.tsx";
import "./ContextPanel.css";

const MODE_CONFIG: Record<ContextMode, { icon: string; label: string }> = {
  spec: { icon: "\uD83D\uDCCB", label: "Spec Context" },
  agent: { icon: "\uD83E\uDD16", label: "Agent Context" },
  code: { icon: "\uD83D\uDCC1", label: "Code Context" },
  empty: { icon: "", label: "" },
};

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

export function ContextPanel() {
  const mode = useContextMode();
  const config = MODE_CONFIG[mode];

  return (
    <div className="context-panel">
      {mode !== "empty" && (
        <div className="context-panel__header">
          <span className="context-panel__mode-icon">{config.icon}</span>
          <span className="context-panel__mode-label">{config.label}</span>
        </div>
      )}
      <div className="context-panel__body">
        <ModeContent mode={mode} />
      </div>
    </div>
  );
}
