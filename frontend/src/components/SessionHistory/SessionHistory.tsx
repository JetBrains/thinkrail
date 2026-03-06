import { useSessionStore } from "@/store/sessionStore.ts";
import { HistoryItem } from "./HistoryItem.tsx";

export function SessionHistory() {
  const archived = useSessionStore((s) => s.archivedSessions);

  if (archived.length === 0) {
    return <div className="progress-empty">No completed sessions</div>;
  }

  const sorted = [...archived].reverse().slice(0, 10);

  return (
    <div className="session-history">
      {sorted.map((s) => (
        <HistoryItem key={s.bonsaiSid} session={s} />
      ))}
    </div>
  );
}
