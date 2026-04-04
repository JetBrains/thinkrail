import { useCallback, useEffect, useState } from "react";
import type { MetaTicket, MetaTicketStatus, MetaTicketType } from "@/types/board.ts";
import type { RightPanelContent } from "./MetaTicketDetail.tsx";
import { useSpecStore } from "@/store/specStore.ts";
import { useBoardStore } from "@/store/boardStore.ts";
import { useSessionStore } from "@/store/sessionStore.ts";
import { getClient } from "@/api/index.ts";
import { createSessionApi } from "@/api/methods/sessions.ts";
import { timeAgo } from "@/utils/format.ts";

interface PlanStepView {
  number: number;
  title: string;
  status: string;
  sessionId?: string | null;
}

interface TicketInfoProps {
  ticket: MetaTicket;
  plan?: Record<string, unknown> | null;
  onTicketUpdated?: (ticket: MetaTicket) => void;
  rightPanel: RightPanelContent;
  onSelectPanel: (panel: RightPanelContent) => void;
}

const STATUS_OPTIONS: MetaTicketStatus[] = [
  "idea", "described", "specified", "planned", "executing", "done",
];

const TYPE_OPTIONS: MetaTicketType[] = [
  "feature", "bug", "idea", "improvement",
];

function stepStatusIcon(status: string): string {
  switch (status) {
    case "done": return "\u2713";
    case "executing": return "\u25CF";
    case "failed": return "\u2717";
    default: return "\u25CB";
  }
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return iso;
  }
}

export function TicketInfo({ ticket, plan, onTicketUpdated, rightPanel, onSelectPanel }: TicketInfoProps) {
  const updateTicket = useBoardStore((s) => s.updateTicket);
  const liveSessions = useSessionStore((s) => s.sessions);
  const archivedSessions = useSessionStore((s) => s.archivedSessions);
  const restoreSession = useSessionStore((s) => s.restoreSession);
  const specs = useSpecStore((s) => s.specs);
  const [descHeight, setDescHeight] = useState(140);

  // Fetch session names from backend so we always show names, even before sessions are restored
  const [sessionNameMap, setSessionNameMap] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    if (ticket.sessionIds.length === 0) return;
    const api = createSessionApi(getClient());
    api.list().then((summaries) => {
      const map = new Map<string, string>();
      for (const s of summaries) {
        if (s.name) map.set(s.bonsaiSid, s.name);
      }
      setSessionNameMap(map);
    }).catch(() => {});
  }, [ticket.sessionIds.length]);
  const [editTitle, setEditTitle] = useState(ticket.title);

  useEffect(() => setEditTitle(ticket.title), [ticket.title]);

  const handleTitleBlur = useCallback(async () => {
    const trimmed = editTitle.trim();
    if (!trimmed || trimmed === ticket.title) {
      setEditTitle(ticket.title);
      return;
    }
    const updated = await updateTicket(ticket.id, { title: trimmed });
    onTicketUpdated?.(updated as MetaTicket);
  }, [editTitle, ticket.id, ticket.title, updateTicket, onTicketUpdated]);

  const handleStatusChange = useCallback(
    async (e: React.ChangeEvent<HTMLSelectElement>) => {
      const updated = await updateTicket(ticket.id, { status: e.target.value as MetaTicketStatus });
      onTicketUpdated?.(updated as MetaTicket);
    },
    [ticket.id, updateTicket, onTicketUpdated],
  );

  const handleTypeChange = useCallback(
    async (e: React.ChangeEvent<HTMLSelectElement>) => {
      const updated = await updateTicket(ticket.id, { type: e.target.value as MetaTicketType });
      onTicketUpdated?.(updated as MetaTicket);
    },
    [ticket.id, updateTicket, onTicketUpdated],
  );

  const linkedSpecs = ticket.linkedSpecIds.map((id) => {
    const spec = specs.find((s) => s.id === id);
    return { id, title: spec?.title ?? id, status: spec?.status ?? "unknown" };
  });

  const planMilestones = (plan?.milestones as { steps?: PlanStepView[] }[]) ?? [];
  const planSteps = planMilestones.flatMap((m) => (m.steps as PlanStepView[]) ?? []);
  const planDone = planSteps.filter((s) => s.status === "done").length;


  const handleDescResize = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startY = e.clientY;
      const startH = descHeight;
      const handleMove = (ev: MouseEvent) => {
        setDescHeight(Math.max(60, startH + ev.clientY - startY));
      };
      const handleUp = () => {
        document.removeEventListener("mousemove", handleMove);
        document.removeEventListener("mouseup", handleUp);
      };
      document.addEventListener("mousemove", handleMove);
      document.addEventListener("mouseup", handleUp);
    },
    [descHeight],
  );

  const isActive = (panel: RightPanelContent) => {
    if (panel.type !== rightPanel.type) return false;
    if (panel.type === "spec" && rightPanel.type === "spec") return panel.specId === rightPanel.specId;
    if (panel.type === "session" && rightPanel.type === "session") return panel.sessionId === rightPanel.sessionId;
    return true;
  };

  return (
    <div className="ticket-info-inner">
      {/* ── Ticket Header Card ── */}
      <div className="ticket-header">
        <input
          className="ticket-header-title-input"
          value={editTitle}
          onChange={(e) => setEditTitle(e.target.value)}
          onBlur={handleTitleBlur}
          onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
        />
        <div className="ticket-header-id" title={ticket.id}>
          Ticket #{ticket.id.slice(-4)}
        </div>
        <div className="ticket-header-props">
          <div className="ticket-header-prop-row">
            <span className="ticket-header-prop-label">Status</span>
            <select
              className={`ticket-header-badge ticket-header-badge--${ticket.status}`}
              value={ticket.status}
              onChange={handleStatusChange}
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <div className="ticket-header-prop-row">
            <span className="ticket-header-prop-label">Type</span>
            <select
              className={`ticket-header-badge ticket-header-badge--${ticket.type}`}
              value={ticket.type}
              onChange={handleTypeChange}
            >
              {TYPE_OPTIONS.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="ticket-header-meta">
          <span>Created {formatDate(ticket.created)}</span>
          <span>{"\u00B7"}</span>
          <span>Updated {timeAgo(ticket.updated)}</span>
        </div>
        <div className="ticket-header-summary">
          {ticket.linkedSpecIds.length > 0 && (
            <span>{ticket.linkedSpecIds.length} spec{ticket.linkedSpecIds.length !== 1 ? "s" : ""}</span>
          )}
          {ticket.sessionIds.length > 0 && (
            <span>{ticket.sessionIds.length} session{ticket.sessionIds.length !== 1 ? "s" : ""}</span>
          )}
          {planSteps.length > 0 && (
            <span>{planDone}/{planSteps.length} steps</span>
          )}
        </div>
      </div>

      {/* ── Description preview ── */}
      <div className="ticket-section">
        <div
          className={`ticket-section-header ticket-section-clickable ${isActive({ type: "description" }) ? "ticket-section-clickable--active" : ""}`}
          onClick={() => onSelectPanel({ type: "description" })}
        >
          <span className="ticket-section-title">Description</span>
        </div>
        <div
          className={`ticket-description-preview ${isActive({ type: "description" }) ? "ticket-section-clickable--active" : ""}`}
          style={{ maxHeight: descHeight, overflow: "auto" }}
          onClick={() => onSelectPanel({ type: "description" })}
        >
          {ticket.body ? (
            <div className="ticket-description-preview-text">{ticket.body}</div>
          ) : (
            <div className="ticket-description-empty">No description yet</div>
          )}
        </div>
        <div className="ticket-desc-resize-handle" onMouseDown={handleDescResize} />
      </div>

      {/* ── Specifications ── */}
      <div className="ticket-section">
        <div className="ticket-section-header">
          <span className="ticket-section-title">Specifications</span>
        </div>
        <div className="ticket-linked-list">
          {linkedSpecs.length === 0 ? (
            <div className="ticket-linked-empty">No specs linked yet.</div>
          ) : (
            linkedSpecs.map((s) => (
              <div
                key={s.id}
                className={`ticket-linked-item ticket-linked-item--clickable ${isActive({ type: "spec", specId: s.id, specTitle: s.title }) ? "ticket-linked-item--active" : ""}`}
                onClick={() => onSelectPanel({ type: "spec", specId: s.id, specTitle: s.title })}
              >
                <span>{s.title}</span>
                <span className={`ticket-linked-status ticket-linked-status--${s.status}`}>
                  {s.status}
                </span>
              </div>
            ))
          )}
        </div>
      </div>

      {/* ── Spec Diffs (replaces Spec Changes + Spec Drafts) ── */}
      <div className="ticket-section">
        <div
          className={`ticket-section-header ticket-section-clickable ${isActive({ type: "spec-diffs" }) ? "ticket-section-clickable--active" : ""}`}
          onClick={() => onSelectPanel({ type: "spec-diffs" })}
        >
          <span className="ticket-section-title">Spec Diffs</span>
          {(ticket.specPatches?.length ?? 0) > 0 && (
            <span className="ticket-section-count">{ticket.specPatches.length} applied</span>
          )}
        </div>
      </div>

      {/* ── Plan ── */}
      <div className="ticket-section">
        <div
          className={`ticket-section-header ticket-section-clickable ${isActive({ type: "plan" }) ? "ticket-section-clickable--active" : ""}`}
          onClick={() => onSelectPanel({ type: "plan" })}
        >
          <span className="ticket-section-title">Plan</span>
          {planSteps.length > 0 && (
            <span className="ticket-linked-status">{planDone}/{planSteps.length}</span>
          )}
        </div>
        <div className="ticket-linked-list">
          {planSteps.length === 0 ? (
            <div className="ticket-linked-empty">
              {ticket.planPath ? "Loading..." : "No plan yet."}
            </div>
          ) : (
            planSteps.map((step) => (
              <div
                key={step.number}
                className={`ticket-linked-item ticket-linked-item--clickable ${
                  step.sessionId && rightPanel.type === "session" && rightPanel.sessionId === step.sessionId
                    ? "ticket-linked-item--active" : ""
                }`}
                onClick={() =>
                  step.sessionId
                    ? onSelectPanel({ type: "session", sessionId: step.sessionId })
                    : onSelectPanel({ type: "plan" })
                }
              >
                <span>
                  <span style={{ marginRight: "var(--space-xs)" }}>{stepStatusIcon(step.status)}</span>
                  Step {step.number}: {step.title}
                </span>
                <span className={`ticket-linked-status ticket-linked-status--${step.status}`}>
                  {step.status}
                </span>
              </div>
            ))
          )}
        </div>
      </div>

      {/* ── Sessions ── */}
      <div className="ticket-section">
        <div className="ticket-section-header">
          <span className="ticket-section-title">Sessions</span>
        </div>
        <div className="ticket-linked-list">
          {(() => {
            const embeddedSid = rightPanel.type === "session" ? rightPanel.sessionId : null;
            const allIds = new Set(ticket.sessionIds);
            if (embeddedSid) allIds.add(embeddedSid);
            if (allIds.size === 0) {
              return <div className="ticket-linked-empty">No sessions yet.</div>;
            }
            return [...allIds].map((sid) => {
              const live = liveSessions.get(sid);
              const archived = !live ? archivedSessions.find((a) => a.bonsaiSid === sid) : null;
              const name = live?.name || archived?.name || sessionNameMap.get(sid) || sid.slice(0, 8);
              const status = live?.status ?? (archived ? "done" : "done");
              const isSessionActive = rightPanel.type === "session" && rightPanel.sessionId === sid;
              return (
                <div
                  key={sid}
                  className={`ticket-linked-item ticket-linked-item--clickable ${isSessionActive ? "ticket-linked-item--active" : ""}`}
                  onClick={async () => {
                    if (!live) {
                      await restoreSession(sid);
                    }
                    onSelectPanel({ type: "session", sessionId: sid });
                  }}
                >
                  <span>{name}</span>
                  <span className={`ticket-linked-status ticket-linked-status--${status}`}>
                    {status}
                  </span>
                </div>
              );
            });
          })()}
        </div>
      </div>
    </div>
  );
}
