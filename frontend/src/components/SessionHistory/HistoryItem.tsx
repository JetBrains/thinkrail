import type { ArchivedSession } from "@/types/session.ts";
import { formatDuration } from "@/utils/format.ts";

interface HistoryItemProps {
  session: ArchivedSession;
}

export function HistoryItem({ session }: HistoryItemProps) {
  const duration = formatDuration(session.durationMs, false);

  return (
    <div className="history-item">
      <div className="history-item-header">
        <span className={`history-badge ${session.result === "done" ? "history-badge-done" : "history-badge-error"}`}>
          {session.result === "done" ? "\u2713" : "\u2715"}
        </span>
        <span className="history-item-name">{session.name}</span>
      </div>
      <div className="history-item-meta">
        ${session.costUsd.toFixed(2)}
        {" \u00B7 "}{session.turns} turns
        {" \u00B7 "}{duration}
      </div>
    </div>
  );
}
