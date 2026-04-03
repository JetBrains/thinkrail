import { useCallback, useState } from "react";
import type { SpecChange } from "@/types/board.ts";

interface TicketSpecChangesViewProps {
  specChanges: SpecChange[];
}

const CHANGE_TYPE_BADGE: Record<string, { label: string; cls: string }> = {
  created: { label: "New", cls: "badge-new" },
  modified: { label: "Modified", cls: "badge-modified" },
  deleted: { label: "Deleted", cls: "badge-deleted" },
};

function SpecChangeEntry({ change }: { change: SpecChange }) {
  const [expanded, setExpanded] = useState(false);
  const badge = CHANGE_TYPE_BADGE[change.changeType] ?? { label: change.changeType, cls: "" };

  const toggle = useCallback(() => setExpanded((v) => !v), []);

  return (
    <div className="spec-change-entry">
      <button className="spec-change-header" onClick={toggle}>
        <span className={`spec-change-badge ${badge.cls}`}>{badge.label}</span>
        <span className="spec-change-title">{change.specTitle}</span>
        <span className="spec-change-expand">{expanded ? "\u25B4" : "\u25BE"}</span>
      </button>
      <div className="spec-change-summary">{change.summary}</div>
      {expanded && (
        <div className="spec-change-detail">
          {change.sectionsChanged.length > 0 && (
            <div className="spec-change-sections">
              Sections: {change.sectionsChanged.join(", ")}
            </div>
          )}
          <div className="spec-change-body">{change.detail}</div>
        </div>
      )}
    </div>
  );
}

export function TicketSpecChangesView({ specChanges }: TicketSpecChangesViewProps) {
  if (specChanges.length === 0) {
    return (
      <div className="ticket-right-panel">
        <div className="ticket-right-header">
          <span className="ticket-right-title">Spec Changes</span>
        </div>
        <div className="ticket-right-body">
          <div className="ticket-placeholder">
            No spec changes recorded yet. Run a "Specify with AI" session to generate spec changes.
          </div>
        </div>
      </div>
    );
  }

  // Group by sessionId
  const grouped = new Map<string, SpecChange[]>();
  for (const c of specChanges) {
    const key = c.sessionId || "unknown";
    const list = grouped.get(key) ?? [];
    list.push(c);
    grouped.set(key, list);
  }

  return (
    <div className="ticket-right-panel">
      <div className="ticket-right-header">
        <span className="ticket-right-title">
          Spec Changes ({specChanges.length})
        </span>
      </div>
      <div className="ticket-right-body spec-changes-list">
        {[...grouped.entries()].map(([sessionId, changes]) => (
          <div key={sessionId} className="spec-change-group">
            <div className="spec-change-group-header">
              Session: {sessionId.slice(0, 8)}...
            </div>
            {changes.map((c, i) => (
              <SpecChangeEntry key={`${c.specId}-${i}`} change={c} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
