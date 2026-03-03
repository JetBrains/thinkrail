import { useSpecStore } from "@/store/specStore.ts";
import { useNotificationStore } from "@/store/notificationStore.ts";

export function StatusBar() {
  const specs = useSpecStore((s) => s.specs);
  const pendingInputCount = useNotificationStore((s) => s.pendingInputCount);
  const total = specs.length;
  const done = specs.filter((s) => s.status === "done").length;
  const pending = specs.filter(
    (s) => s.status === "active" || s.status === "draft",
  ).length;

  return (
    <footer className="status-bar">
      <div className="status-left">
        <span>{total} specs</span>
        <span className="status-sep" />
        <span>{done} done</span>
        <span className="status-sep" />
        <span>{pending} pending</span>
        {pendingInputCount > 0 && (
          <>
            <span className="status-sep" />
            <span className="status-attention">
              {pendingInputCount} session{pendingInputCount !== 1 ? "s" : ""}{" "}
              need attention
            </span>
          </>
        )}
      </div>
      <div className="status-right">
        <span className="status-hint">Cmd+T New</span>
        <span className="status-hint">Ctrl+B Tree</span>
        <span className="status-hint">Cmd+K Search</span>
      </div>
    </footer>
  );
}
