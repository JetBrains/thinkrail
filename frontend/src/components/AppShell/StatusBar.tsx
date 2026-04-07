import { useState, useRef, useEffect, useCallback } from "react";
import { useSpecStore } from "@/store/specStore.ts";
import { useSessionStore } from "@/store/sessionStore.ts";
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
  const openTabsSet = useSessionStore((s) => s.openTabs);
  const openTab = useSessionStore((s) => s.openTab);
  const endSession = useSessionStore((s) => s.endSession);
  const focusSession = useSessionStore((s) => s.focusSession);
  const dashboard = useVisStore((s) => s.dashboard);
  const dd = useDropdown();
  const attnDd = useDropdown();

  const total = specs.length;
  const done = specs.filter((s) => s.status === "done").length;
  const pending = specs.filter(
    (s) => s.status === "active" || s.status === "draft",
  ).length;

  const allLive = Array.from(sessions.values()).filter(
    (s) => s.status !== "done" && s.status !== "error",
  );
  const bgSessions = allLive.filter((s) => !openTabsSet.has(s.bonsaiSid));
  const bgCount = bgSessions.length;
  const attnSessions = allLive.filter((s) => s.pendingRequest !== null);
  const attnCount = attnSessions.length;

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
        <div className="status-bg-sessions" ref={dd.ref}>
          <button
            className={`status-sessions-btn${bgCount > 0 ? " status-sessions-btn--bg" : ""}`}
            onClick={bgCount > 0 ? dd.toggle : onOpenSessionManager}
          >
            {allLive.length} session{allLive.length !== 1 ? "s" : ""}
            {bgCount > 0 && <span className="status-bg-count"> ({bgCount} background)</span>}
          </button>
          {dd.open && bgCount > 0 && (
            <div className="status-bg-dropdown">
              {bgSessions.map((s) => (
                <div key={s.bonsaiSid} className="status-bg-item">
                  <button
                    className="status-bg-restore"
                    onClick={() => { openTab(s.bonsaiSid); dd.close(); }}
                  >
                    <span className={`status-bg-dot status-bg-${s.status}`} />
                    {s.name || s.bonsaiSid.slice(0, 8)}
                    <span className="status-bg-state">{s.status}</span>
                  </button>
                  <button
                    className="status-bg-end"
                    onClick={() => endSession(s.bonsaiSid)}
                    title="End session"
                  >
                    &#10005;
                  </button>
                </div>
              ))}
              <div className="status-bg-divider" />
              <button
                className="status-bg-manage"
                onClick={() => { onOpenSessionManager(); dd.close(); }}
              >
                All sessions...
              </button>
            </div>
          )}
        </div>
        {attnCount > 0 && (
          <>
            <span className="status-sep" />
            <div className="status-attn-wrap" ref={attnDd.ref}>
              <button className="status-attn-btn" onClick={attnDd.toggle}>
                {attnCount} need attention
              </button>
              {attnDd.open && (
                <div className="status-attn-dropdown">
                  {attnSessions.map((s) => (
                    <button
                      key={s.bonsaiSid}
                      className="status-attn-item"
                      onClick={() => { focusSession(s.bonsaiSid); attnDd.close(); }}
                    >
                      <span className={`status-bg-dot status-bg-${s.status}`} />
                      <span className="status-attn-name">{s.name || s.bonsaiSid.slice(0, 8)}</span>
                      <span className={`status-attn-badge status-attn-badge--${s.pendingRequest?.type ?? "question"}`}>
                        {s.pendingRequest?.type === "approval" ? "A"
                          : s.pendingRequest?.type === "suggestion" || s.pendingRequest?.type === "step-proposal" ? "S"
                          : "Q"}
                      </span>
                    </button>
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
