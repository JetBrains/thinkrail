import { useCallback, useEffect, useMemo, useState } from "react";
import { useRpc } from "@/api/hooks/useRpc.tsx";
import type { SessionSummary } from "@/api/methods/sessions.ts";
import { useSessionStore } from "@/store/sessionStore.ts";
import { useBoardStore } from "@/store/boardStore.ts";
import { useUiStore } from "@/store/uiStore.ts";
import { useNotificationStore } from "@/store/notificationStore.ts";
import { getErrorMessage } from "@/utils/errors.ts";
import { timeAgo } from "@/utils/format.ts";
import { getStatusStyle } from "@/utils/status.ts";
import { modLabel } from "@/utils/platform.ts";
import { SessionCardContextMenu } from "./SessionCardContextMenu.tsx";
import { groupByTicket, type TicketGroup } from "./groupByTicket.ts";
import "./SessionManager.css";

const TICKET_STRIPE_PALETTE = [
  "var(--blue)",
  "var(--purple)",
  "var(--green)",
  "var(--gold)",
  "var(--red)",
];

function ticketStripeColor(ticketId: string | null | undefined): string | null {
  if (!ticketId) return null;
  let hash = 0;
  for (let i = 0; i < ticketId.length; i++) {
    hash = ((hash << 5) - hash) + ticketId.charCodeAt(i);
    hash |= 0;
  }
  return TICKET_STRIPE_PALETTE[Math.abs(hash) % TICKET_STRIPE_PALETTE.length];
}

function sortByRecency(sessions: SessionSummary[]): SessionSummary[] {
  return [...sessions].sort((a, b) => {
    const ta = Date.parse(a.updatedAt || a.createdAt || "") || 0;
    const tb = Date.parse(b.updatedAt || b.createdAt || "") || 0;
    return tb - ta;
  });
}

const GENERIC_NAME_RE = /^Session \d+$/;

function readMetricNumber(metrics: Record<string, unknown> | undefined, key: string): number {
  if (!metrics) return 0;
  const v = metrics[key];
  return typeof v === "number" ? v : 0;
}

function formatCost(usd: number): string {
  if (usd >= 10) return `$${usd.toFixed(0)}`;
  if (usd >= 1) return `$${usd.toFixed(2)}`;
  if (usd > 0) return `$${usd.toFixed(2)}`;
  return "$0";
}

type CtxMenuState = {
  bonsaiSid: string;
  ticketId: string | null;
  x: number;
  y: number;
};

export function SessionManager() {
  const client = useRpc();
  const projectPath = useUiStore((s) => s.projectPath);
  const setCenterView = useUiStore((s) => s.setCenterView);
  const focusSessions = useUiStore((s) => s.focusSessions);
  const switchSession = useSessionStore((s) => s.switchSession);
  const restoreSession = useSessionStore((s) => s.restoreSession);
  const deleteSession = useSessionStore((s) => s.deleteSession);
  const sessions = useSessionStore((s) => s.sessionList);
  const refreshSessionList = useSessionStore((s) => s.refreshSessionList);
  const tickets = useBoardStore((s) => s.tickets);
  const openTicket = useBoardStore((s) => s.openTicket);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ctxMenu, setCtxMenu] = useState<CtxMenuState | null>(null);

  const refresh = useCallback(async () => {
    try {
      await refreshSessionList();
      setError(null);
    } catch (e) {
      setError(`Failed to load sessions: ${getErrorMessage(e)}`);
    }
  }, [refreshSessionList]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        await refreshSessionList();
      } catch (e) {
        if (!cancelled) {
          setError(`Failed to load sessions: ${getErrorMessage(e)}`);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshSessionList, projectPath]);

  const handleDelete = useCallback(
    async (taskId: string) => {
      try {
        await deleteSession(taskId);
        await refresh();
      } catch (e) {
        console.error("Failed to delete session:", e);
      }
    },
    [deleteSession, refresh],
  );

  const handleOpen = useCallback(
    async (taskId: string) => {
      focusSessions();
      try {
        if (useSessionStore.getState().sessions.has(taskId)) {
          switchSession(taskId);
        } else {
          await restoreSession(taskId);
        }
      } catch (e) {
        console.error("Failed to open session:", e);
        setError(`Failed to open session: ${getErrorMessage(e)}`);
      }
    },
    [focusSessions, switchSession, restoreSession],
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, s: SessionSummary) => {
      e.preventDefault();
      setCtxMenu({
        bonsaiSid: s.bonsaiSid,
        ticketId: s.ticketId ?? null,
        x: e.clientX,
        y: e.clientY,
      });
    },
    [],
  );

  const handleOpenTicket = useCallback(
    (ticketId: string, _bonsaiSid: string) => {
      setCenterView("board");
      openTicket(ticketId);
    },
    [setCenterView, openTicket],
  );

  const handleCopySid = useCallback(async (bonsaiSid: string) => {
    try {
      await navigator.clipboard.writeText(bonsaiSid);
      useNotificationStore.getState().addToast({
        eventType: "success",
        message: `Copied session ID: ${bonsaiSid.slice(0, 8)}…`,
        persistent: false,
      });
    } catch (err) {
      console.error("Failed to copy session ID:", err);
      useNotificationStore.getState().addToast({
        eventType: "error",
        message: "Could not copy session ID — clipboard blocked",
        persistent: false,
      });
    }
  }, []);

  const ordered = useMemo(() => sortByRecency(sessions), [sessions]);
  const grouped = useMemo(() => groupByTicket(ordered), [ordered]);

  const handleOpenTicketGroup = useCallback(
    (group: TicketGroup) => {
      setCenterView("board");
      openTicket(group.ticketId);
    },
    [setCenterView, openTicket],
  );

  // Discard the unused RPC client reference so the lint hook stays clean;
  // the prop is retained because handleDelete may grow to call the API
  // directly in the future.
  void client;

  if (loading) {
    return <div className="sm-loading">Loading sessions...</div>;
  }

  return (
    <div className="session-manager">
      <div className="sm-header">
        <button className="sm-refresh" onClick={refresh} title="Refresh sessions">
          {"↻"}
        </button>
      </div>

      <div className="sm-content">
        {error && <div className="sm-error">{error}</div>}

        {grouped.length === 0 && !error && (
          <div className="sm-empty">No sessions yet. Create one with {modLabel("T")}.</div>
        )}

        {grouped.map((entry) => {
          if (entry.kind === "ticket") {
            const ticket = tickets.get(entry.ticketId) ?? null;
            return (
              <TicketGroupCard
                key={`sm-t-${entry.ticketId}`}
                group={entry}
                title={ticket?.title ?? `Ticket #${entry.ticketId.slice(-4)}`}
                shortId={`#${entry.ticketId.slice(-4)}`}
                onOpen={handleOpenTicketGroup}
              />
            );
          }
          // Standalone session: render the existing card. Ticket-related
          // props are null because the session has no ticket.
          return (
            <SessionCard
              key={`sm-${entry.session.bonsaiSid}`}
              session={entry.session}
              ticketTitle={null}
              ticketShortId={null}
              onOpen={handleOpen}
              onDelete={handleDelete}
              onContextMenu={handleContextMenu}
            />
          );
        })}
      </div>

      {ctxMenu && (
        <SessionCardContextMenu
          bonsaiSid={ctxMenu.bonsaiSid}
          ticketId={ctxMenu.ticketId}
          x={ctxMenu.x}
          y={ctxMenu.y}
          onClose={() => setCtxMenu(null)}
          onOpenTicket={handleOpenTicket}
          onCopySid={handleCopySid}
        />
      )}
    </div>
  );
}

const TrashIcon = (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M2.5 4h11" />
    <path d="M5.5 4V2.75A1.25 1.25 0 0 1 6.75 1.5h2.5A1.25 1.25 0 0 1 10.5 2.75V4" />
    <path d="M4 4l.7 9.1A1.5 1.5 0 0 0 6.2 14.5h3.6a1.5 1.5 0 0 0 1.5-1.4L12 4" />
    <path d="M6.75 7v4" />
    <path d="M9.25 7v4" />
  </svg>
);

const TurnsIcon = (
  <svg className="sm-chip-ic" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M2 6a4 4 0 1 1 1.2 2.8" />
    <path d="M2 9V6.5h2.5" />
  </svg>
);

function TicketGroupCard({
  group,
  title,
  shortId,
  onOpen,
}: {
  group: TicketGroup;
  title: string;
  shortId: string;
  onOpen: (group: TicketGroup) => void;
}) {
  const stripe = ticketStripeColor(group.ticketId);
  const count = group.sessions.length;
  // Status: attention beats running beats idle. Mirrors the focus rule
  // (the user wanted to land on whichever session needs them first).
  const needsAttention = group.attentionCount > 0;
  const running = !needsAttention && group.runningCount > 0;
  const statusLabel = needsAttention
    ? `${group.attentionCount} needs attention`
    : running
      ? `${group.runningCount} running`
      : "idle";
  const classes = [
    "sm-card",
    "sm-card--ticket-group",
    needsAttention && "sm-card--needs-attention",
    running && "sm-card--running",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={classes}
      role="button"
      tabIndex={0}
      style={{ ["--ticket-color" as string]: stripe ?? "var(--blue)" }}
      onClick={() => onOpen(group)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(group);
        }
      }}
    >
      <span className="sm-ticket-stripe sm-ticket-stripe--lead" aria-hidden="true" />
      <span className="sm-name" title={title}>{title}</span>
      <span className="sm-ticket-id">{shortId}</span>
      <span className="sm-time">{timeAgo(group.latestActivity)}</span>
      <span className="sm-metrics">
        <span className="sm-chip" title="Sessions attached to this ticket">
          {count} {count === 1 ? "session" : "sessions"}
        </span>
      </span>
      <span className="sm-actions">
        <span className={`sm-status-label${needsAttention ? " sm-status-label--attention" : running ? " sm-status-label--running" : ""}`}>
          {statusLabel}
        </span>
      </span>
    </div>
  );
}

function SessionCard({
  session: s,
  ticketTitle,
  ticketShortId,
  onOpen,
  onDelete,
  onContextMenu,
}: {
  session: SessionSummary;
  ticketTitle: string | null;
  ticketShortId: string | null;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onContextMenu: (e: React.MouseEvent, s: SessionSummary) => void;
}) {
  const turns = readMetricNumber(s.metrics, "turns");
  const cost = readMetricNumber(s.metrics, "costUsd");
  const hasMetrics = turns > 0 || cost > 0;
  const isDraft = s.status === "draft";
  const isRunning = s.status === "running";
  const isWaiting = s.status === "waiting";
  const isGenericName = GENERIC_NAME_RE.test(s.name);
  const stripe = ticketStripeColor(s.ticketId);

  const classes = [
    "sm-card",
    `sm-card--${s.status}`,
    !ticketTitle && "sm-card--no-ticket",
    !hasMetrics && "sm-card--no-metrics",
    isWaiting && "sm-card--needs-attention",
  ]
    .filter(Boolean)
    .join(" ");

  const nameClass = [
    "sm-name",
    isDraft && "sm-name--draft",
    !isDraft && isGenericName && "sm-name--generic",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={classes}
      role="button"
      tabIndex={0}
      onClick={() => onOpen(s.bonsaiSid)}
      onContextMenu={(e) => onContextMenu(e, s)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(s.bonsaiSid);
        }
      }}
    >
      <span className={`sm-dot sm-dot--${s.status}`} aria-hidden="true" />
      <span className={nameClass}>{s.name || s.bonsaiSid.slice(0, 8)}</span>
      <span className={`sm-time${isRunning ? " sm-time--live" : ""}`}>
        {isRunning ? "now" : timeAgo(s.updatedAt || s.createdAt)}
      </span>

      {ticketTitle && (
        <span className="sm-ticket-row">
          <span className="sm-ticket-chip" style={{ ["--ticket-color" as string]: stripe ?? "var(--blue)" }}>
            <span className="sm-ticket-stripe" aria-hidden="true" />
            <span className="sm-ticket-title">{ticketTitle}</span>
            {ticketShortId && <span className="sm-ticket-id">{ticketShortId}</span>}
          </span>
        </span>
      )}

      <span className="sm-metrics">
        {hasMetrics && (
          <>
            {turns > 0 && (
              <span className="sm-chip sm-chip--turns" title={`${turns} ${turns === 1 ? "turn" : "turns"}`}>
                {TurnsIcon}
                {turns}
              </span>
            )}
            {cost > 0 && (
              <span className="sm-chip sm-chip--cost" title="Cost">
                {formatCost(cost)}
              </span>
            )}
          </>
        )}
      </span>

      <span className="sm-actions" onClick={(e) => e.stopPropagation()}>
        <span className="sm-status-label">{getStatusStyle(s.status).label.toLowerCase()}</span>
        <button
          className="sm-icon-btn"
          type="button"
          aria-label="Delete session"
          title="Delete session"
          onClick={() => onDelete(s.bonsaiSid)}
        >
          {TrashIcon}
        </button>
      </span>
    </div>
  );
}
