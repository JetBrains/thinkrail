import { useState, useRef, useEffect, useCallback } from "react";
import { useSpecStore } from "@/store/specStore.ts";
import { useSessionStore } from "@/store/sessionStore.ts";
import { useNotificationStore } from "@/store/notificationStore.ts";
import { useVisStore } from "@/store/visStore.ts";
import { modLabel } from "@/utils/platform.ts";

function useDropdown() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const toggle = useCallback(() => setOpen((v) => !v), []);
  const close = useCallback(() => setOpen(false), []);
  useEffect(() => {
    if (!open) return;
    function handleMouseDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [open]);
  return { open, ref, toggle, close } as const;
}

interface StatusBarProps {
  onOpenSessionManager: () => void;
}

export function StatusBar({ onOpenSessionManager }: StatusBarProps) {
  const specs = useSpecStore((s) => s.specs);
  const sessions = useSessionStore((s) => s.sessions);
  const bgSessions = useSessionStore((s) => s.backgroundSessions);
  const restoreFromBackground = useSessionStore((s) => s.restoreFromBackground);
  const endBackgroundSession = useSessionStore((s) => s.endBackgroundSession);
  const pendingInputCount = useNotificationStore((s) => s.pendingInputCount);
  const dashboard = useVisStore((s) => s.dashboard);
  const bgDd = useDropdown();

  const total = specs.length;
  const done = specs.filter((s) => s.status === "done").length;
  const pending = specs.filter(
    (s) => s.status === "active" || s.status === "draft",
  ).length;
  const sessionCount = sessions.size;
  const bgCount = bgSessions.size;

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
        {bgCount > 0 && (
          <>
            <span className="status-sep" />
            <div className="status-bg-sessions" ref={bgDd.ref}>
              <button className="status-bg-btn" onClick={bgDd.toggle}>
                &#10227; {bgCount} background
              </button>
              {bgDd.open && (
                <div className="status-bg-dropdown">
                  {Array.from(bgSessions.values()).map((s) => (
                    <div key={s.bonsaiSid} className="status-bg-item">
                      <button
                        className="status-bg-restore"
                        onClick={() => { restoreFromBackground(s.bonsaiSid); bgDd.close(); }}
                      >
                        <span className={`status-bg-dot status-bg-${s.status}`} />
                        {s.name || s.bonsaiSid.slice(0, 8)}
                        <span className="status-bg-state">{s.status}</span>
                      </button>
                      <button
                        className="status-bg-end"
                        onClick={() => endBackgroundSession(s.bonsaiSid)}
                        title="End session"
                      >
                        &#10005;
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
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
