import { useSpecStore } from "@/store/specStore.ts";
import { useSessionStore } from "@/store/sessionStore.ts";
import { useNotificationStore } from "@/store/notificationStore.ts";
import { useVizStore } from "@/store/vizStore.ts";
import { modLabel } from "@/utils/platform.ts";

interface StatusBarProps {
  onOpenSessionManager: () => void;
}

export function StatusBar({ onOpenSessionManager }: StatusBarProps) {
  const specs = useSpecStore((s) => s.specs);
  const sessions = useSessionStore((s) => s.sessions);
  const pendingInputCount = useNotificationStore((s) => s.pendingInputCount);
  const dashboard = useVizStore((s) => s.dashboard);
  const total = specs.length;
  const done = specs.filter((s) => s.status === "done").length;
  const pending = specs.filter(
    (s) => s.status === "active" || s.status === "draft",
  ).length;
  const sessionCount = sessions.size;

  return (
    <footer className="status-bar">
      <div className="status-left">
        {dashboard ? (
          <span className="status-oneliner">{dashboard.one_liner}</span>
        ) : (
          <>
            <span>{total} specs</span>
            <span className="status-sep" />
            <span>{done} done</span>
            <span className="status-sep" />
            <span>{pending} pending</span>
          </>
        )}
        <span className="status-sep" />
        <button className="status-sessions-btn" onClick={onOpenSessionManager}>
          {sessionCount} session{sessionCount !== 1 ? "s" : ""}
        </button>
        {pendingInputCount > 0 && (
          <>
            <span className="status-sep" />
            <span className="status-attention">
              {pendingInputCount} need attention
            </span>
          </>
        )}
      </div>
      <div className="status-right">
        <span className="status-hint">{modLabel("T")} New</span>
        <span className="status-hint">{modLabel("B")} Tree</span>
        <span className="status-hint">{modLabel("J")} Context</span>
        <span className="status-hint">{modLabel("K")} Search</span>
      </div>
    </footer>
  );
}
