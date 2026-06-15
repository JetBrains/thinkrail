import { useState, useRef, useEffect, useCallback } from "react";
import { useSpecStore } from "@/store/specStore.ts";
import { useSessionStore } from "@/store/sessionStore.ts";
import { useBoardStore } from "@/store/boardStore.ts";
import { modLabel } from "@/utils/platform.ts";
import type { Session } from "@/types/session.ts";

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
  const tickets = useBoardStore((s) => s.tickets);
  const openTicket = useBoardStore((s) => s.openTicket);
  const dd = useDropdown();
  const attnDd = useDropdown();

  // Ticket-attached sessions are routed through the ticket view. The
  // session never becomes a free-standing tab. Mirrors the SessionManager
  // grouping rule so the two surfaces behave consistently.
  const labelFor = useCallback((s: Session): string => {
    const ticketId = s.ticketId ?? null;
    const base = s.name || s.thinkrailSid.slice(0, 8);
    if (!ticketId) return base;
    const ticket = tickets.get(ticketId) ?? null;
    const ticketLabel = ticket?.title ?? `Ticket #${ticketId.slice(-4)}`;
    return `${ticketLabel}: ${base}`;
  }, [tickets]);

  const openSessionContext = useCallback((s: Session) => {
    const ticketId = s.ticketId ?? null;
    if (ticketId) {
      openTicket(ticketId);
      return;
    }
    openTab(s.thinkrailSid);
  }, [openTab, openTicket]);

  const focusSessionContext = useCallback((s: Session) => {
    const ticketId = s.ticketId ?? null;
    if (ticketId) {
      openTicket(ticketId);
      return;
    }
    focusSession(s.thinkrailSid);
  }, [focusSession, openTicket]);

  const total = specs.length;
  const done = specs.filter((s) => s.status === "done").length;
  const pending = specs.filter(
    (s) => s.status === "active" || s.status === "draft",
  ).length;

  const sessionList = useSessionStore((s) => s.sessionList);
  const allLive = Array.from(sessions.values()).filter(
    (s) => s.status !== "finished" && s.status !== "error",
  );
  const bgSessions = allLive.filter((s) => !openTabsSet.has(s.thinkrailSid));
  const bgCount = bgSessions.length;
  const attnSessions = allLive.filter((s) => s.pendingRequests.length > 0);
  const attnCount = attnSessions.length;
  // Pill matches what the sidebar Sessions panel shows: the full
  // session/list response (live + on-disk, every status). Falls back
  // to in-memory live sessions only while the first list() hasn't
  // resolved.
  const totalCount = sessionList.length > 0 ? sessionList.length : allLive.length;

  return (
    <footer className="status-bar">
      <div className="status-left">
        <>
          <span>{total} specs</span>
          <span className="status-sep" />
          <span>{done} done</span>
          <span className="status-sep" />
          <span>{pending} pending</span>
        </>
        <span className="status-sep" />
        <div className="status-bg-sessions" ref={dd.ref}>
          <button
            className={`status-sessions-btn${bgCount > 0 ? " status-sessions-btn--bg" : ""}`}
            onClick={onOpenSessionManager}
          >
            {totalCount} session{totalCount !== 1 ? "s" : ""}
          </button>
          {bgCount > 0 && (
            <button
              className="status-sessions-bg-chevron"
              onClick={dd.toggle}
              aria-label="Show background sessions"
              aria-expanded={dd.open}
            >
              <span className="status-bg-count">({bgCount} background)</span>
              <span className="status-sessions-bg-arrow">{dd.open ? "▴" : "▾"}</span>
            </button>
          )}
          {dd.open && bgCount > 0 && (
            <div className="status-bg-dropdown">
              {bgSessions.map((s) => (
                <div key={s.thinkrailSid} className="status-bg-item">
                  <button
                    className="status-bg-restore"
                    title={s.name || s.thinkrailSid}
                    onClick={() => { openSessionContext(s); dd.close(); }}
                  >
                    <span className={`status-bg-dot status-bg-${s.status}`} />
                    {labelFor(s)}
                    <span className="status-bg-state">{s.status}</span>
                  </button>
                  <button
                    className="status-bg-end"
                    onClick={() => endSession(s.thinkrailSid)}
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
                      key={s.thinkrailSid}
                      className="status-attn-item"
                      title={s.name || s.thinkrailSid}
                      onClick={() => { focusSessionContext(s); attnDd.close(); }}
                    >
                      <span className={`status-bg-dot status-bg-${s.status}`} />
                      <span className="status-attn-name">{labelFor(s)}</span>
                      <span className={`status-attn-badge status-attn-badge--${s.pendingRequests[0]?.type ?? "question"}`}>
                        {s.pendingRequests[0]?.type === "approval" ? "A"
                          : s.pendingRequests[0]?.type === "suggestion" || s.pendingRequests[0]?.type === "step-proposal" ? "S"
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
      </div>
    </footer>
  );
}
