import { useCallback, useEffect, useMemo, useState } from "react";
import type { Ticket, TicketType, OrchestrationConfig } from "@/types/board.ts";
import { useBoardStore } from "@/store/boardStore.ts";
import { useSessionStore } from "@/store/sessionStore.ts";
import { useTicketRouteStore } from "@/store/ticketRouteStore.ts";
import { getClient } from "@/api/index.ts";
import { createBoardApi } from "@/api/methods/board.ts";
import { StaleRefsBanner } from "@/components/shared/StaleRefsBanner.tsx";
import { timeAgo } from "@/utils/format.ts";
import { deriveLifecycle, findStageNode, latestNodeSessionId } from "@/utils/lifecycle.ts";
import { StageGraph } from "./StageGraph.tsx";
import { OrchestrationControls } from "./OrchestrationControls.tsx";
import { MarkdownEditor } from "@/components/MarkdownEditor/MarkdownEditor.tsx";
import { ChatMarkdown } from "@/components/ChatStream/ChatMarkdown.tsx";
import { Button } from "@/components/ui/Button";
import "./TicketDetail.css";

const TYPE_OPTIONS: TicketType[] = [
  "feature", "bug", "idea", "improvement",
];

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return iso;
  }
}

/** The phase tree shown in the AppShell left panel when in ticket route.
 *  Reads everything from `ticketRouteStore` + session/board stores; writes
 *  selections back into `ticketRouteStore` for the center and right panels
 *  to react to. */
export function TicketInfo() {
  const ticket = useTicketRouteStore((s) => s.ticket);
  const historyEntries = useTicketRouteStore((s) => s.historyEntries);
  const sessionSummaries = useTicketRouteStore((s) => s.sessionSummaries);
  const setTicket = useTicketRouteStore((s) => s.setTicket);
  const setSelectedArtifact = useTicketRouteStore((s) => s.setSelectedArtifact);

  const liveSessionsMap = useSessionStore((s) => s.sessions);
  const archivedSessionsList = useSessionStore((s) => s.archivedSessions);
  const restoreSession = useSessionStore((s) => s.restoreSession);
  const focusSession = useSessionStore((s) => s.focusSession);

  // Open a ticket-attached session as its own session tab (ticket = folder,
  // session = file). The ticket tab stays open; the session tab becomes active.
  const openSessionTab = useCallback(
    async (sid: string) => {
      if (useSessionStore.getState().sessions.has(sid)) {
        focusSession(sid, { allowTicketTab: true });
      } else {
        await restoreSession(sid, { allowTicketTab: true });
      }
    },
    [focusSession, restoreSession],
  );

  const updateTicket = useBoardStore((s) => s.updateTicket);
  const getStaleTicketRefs = useBoardStore((s) => s.getStaleTicketRefs);
  const fixStaleTicketRefs = useBoardStore((s) => s.fixStaleTicketRefs);

  const [descHeight, setDescHeight] = useState(140);
  const [editingDescription, setEditingDescription] = useState(false);
  const [descDraft, setDescDraft] = useState(ticket?.body ?? "");
  const [editTitle, setEditTitle] = useState(ticket?.title ?? "");

  useEffect(() => setDescDraft(ticket?.body ?? ""), [ticket?.body]);
  useEffect(() => setEditTitle(ticket?.title ?? ""), [ticket?.title]);

  const knownSessionIds = useMemo(
    () => new Set<string>(sessionSummaries.keys()),
    [sessionSummaries],
  );

  const lifecycle = useMemo(
    () => deriveLifecycle(ticket?.stages ?? []),
    [ticket?.stages],
  );

  const handleSaveDescription = useCallback(async () => {
    if (!ticket) return;
    const updated = await updateTicket(ticket.id, { body: descDraft });
    setTicket(updated as Ticket);
    setEditingDescription(false);
  }, [updateTicket, ticket, descDraft, setTicket]);

  const handleCancelDescription = useCallback(() => {
    setDescDraft(ticket?.body ?? "");
    setEditingDescription(false);
  }, [ticket?.body]);

  const handleTitleBlur = useCallback(async () => {
    if (!ticket) return;
    const trimmed = editTitle.trim();
    if (!trimmed || trimmed === ticket.title) {
      setEditTitle(ticket.title);
      return;
    }
    const updated = await updateTicket(ticket.id, { title: trimmed });
    setTicket(updated as Ticket);
  }, [editTitle, ticket, updateTicket, setTicket]);

  const handleTypeChange = useCallback(
    async (e: React.ChangeEvent<HTMLSelectElement>) => {
      if (!ticket) return;
      const updated = await updateTicket(ticket.id, { type: e.target.value as TicketType });
      setTicket(updated as Ticket);
    },
    [ticket, updateTicket, setTicket],
  );

  const handleOrchChange = useCallback(
    (patch: Partial<OrchestrationConfig>) => {
      if (!ticket) return;
      // Optimistic local update; the backend merges the partial patch and
      // broadcasts ticket/didChange to reconcile.
      setTicket({ ...ticket, orchestration: { ...ticket.orchestration, ...patch } } as Ticket);
      createBoardApi(getClient())
        .setOrchestration(ticket.id, patch as Record<string, unknown>)
        .catch((e) => console.error("[TicketInfo] Failed to update orchestration:", e));
    },
    [ticket, setTicket],
  );

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

  if (!ticket) {
    return <div className="ticket-info-inner">Loading ticket...</div>;
  }

  const staleRefs = getStaleTicketRefs(ticket.id, knownSessionIds);

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
            <span
              className={`ticket-header-badge ticket-header-badge--${lifecycle}`}
              title="Derived from stage progress"
            >
              {lifecycle}
            </span>
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
          <span>{"·"}</span>
          <span>Updated {timeAgo(ticket.updated)}</span>
        </div>
        <div className="ticket-header-summary">
          {ticket.linkedSpecIds.length > 0 && (
            <span>{ticket.linkedSpecIds.length} spec{ticket.linkedSpecIds.length !== 1 ? "s" : ""}</span>
          )}
          {ticket.sessionIds.length > 0 && (
            <span>{ticket.sessionIds.length} session{ticket.sessionIds.length !== 1 ? "s" : ""}</span>
          )}
        </div>
      </div>

      {/* ── Description preview / editor ── */}
      <div className="ticket-section">
        <div className="ticket-section-header">
          <span className="ticket-section-title">Description</span>
          {!editingDescription ? (
            <button
              className="ticket-desc-edit-btn"
              title="Edit description"
              onClick={() => setEditingDescription(true)}
            >
              {"✎"}
            </button>
          ) : (
            <div className="ticket-desc-edit-actions">
              <Button variant="primary" size="sm" onClick={handleSaveDescription}>Save</Button>
              <Button size="sm" onClick={handleCancelDescription}>Cancel</Button>
            </div>
          )}
        </div>
        {editingDescription ? (
          <div style={{ height: descHeight, minHeight: 60, display: "flex", flexDirection: "column" }}>
            <MarkdownEditor
              value={descDraft}
              onChange={setDescDraft}
              preview={false}
              initialMode="edit"
              lineNumbers="off"
            />
          </div>
        ) : (
          <div
            className="ticket-description-preview"
            style={{ maxHeight: descHeight, overflow: "auto" }}
          >
            {ticket.body ? (
              <div className="ticket-description-preview-text">
                <ChatMarkdown content={ticket.body} />
              </div>
            ) : (
              <div className="ticket-description-empty">
                No description yet. Click {"✎"} to add one, or run <code>ticket-product-design</code> to populate it.
              </div>
            )}
          </div>
        )}
        <div className="ticket-desc-resize-handle" onMouseDown={handleDescResize} />
      </div>

      {/* ── Progress (vertical phase list with expandable artifacts/sessions) ── */}
      {staleRefs && staleRefs.staleSessionIds.length > 0 && (
        <StaleRefsBanner
          message={`${staleRefs.staleSessionIds.length} session${staleRefs.staleSessionIds.length !== 1 ? "s" : ""} no longer exist${staleRefs.staleSessionIds.length !== 1 ? "" : "s"}`}
          onFix={() => fixStaleTicketRefs(ticket.id)}
          actionLabel="Remove stale links"
        />
      )}
      {/* ── Orchestration settings (always shown, above the orchestrator) ── */}
      <div className="ticket-orch-section">
        <span className="ticket-section-title">Orchestration</span>
        <OrchestrationControls config={ticket.orchestration} onChange={handleOrchChange} />
      </div>

      {/* ── Orchestrator entry point ── */}
      {ticket.orchestrator?.sessionId && (() => {
        const sid = ticket.orchestrator!.sessionId!;
        const live = liveSessionsMap.get(sid);
        const archived = !live ? archivedSessionsList.find((a) => a.thinkrailSid === sid) : null;
        const status = live?.status ?? archived?.result ?? "interrupted";
        const isRunning = status === "running" || status === "waiting";
        return (
          <div
            className="ticket-history-row"
            onClick={() => void openSessionTab(sid)}
            title="Open orchestrator session"
            style={{ cursor: "pointer" }}
          >
            <span className="ticket-history-row-title">
              {isRunning ? "● " : "○ "}Orchestrator
            </span>
            <span className="ticket-history-row-count" style={{ opacity: 0.6, fontSize: "0.75em" }}>
              {status}
            </span>
          </div>
        );
      })()}

      <StageGraph
        state={ticket as unknown as Parameters<typeof StageGraph>[0]["state"]}
        onFocusNode={(nodeId) => {
          // Clicking a stage opens its latest session (if it has run one).
          const node = findStageNode(ticket.stages, nodeId);
          const sid = node ? latestNodeSessionId(node) : null;
          if (sid) void openSessionTab(sid);
        }}
        onFocusSession={(sid) => void openSessionTab(sid)}
        onOpenFile={(path) => setSelectedArtifact({ kind: "file", filePath: path })}
        onSelectArtifact={(rawKind) => {
          // Normalize hyphenated names from WorkNode to snake_case ArtifactKind
          const kind = rawKind.replace(/-/g, "_");
          if (kind === "implementation_plan") setSelectedArtifact({ kind: "plan" });
          else if (kind === "history") setSelectedArtifact({ kind: "history" });
          else setSelectedArtifact({ kind: "canonical", artifact: kind as never });
        }}
      />

      <div
        className={`ticket-history-row ${historyEntries.length === 0 ? "ticket-history-row--empty" : ""}`}
        onClick={() => setSelectedArtifact({ kind: "history" })}
        title={
          historyEntries.length === 0
            ? "No amendments yet — apply a ProposeChange to start a history"
            : undefined
        }
      >
        <span className="ticket-history-row-title">History</span>
        <span className="ticket-history-row-count">({historyEntries.length})</span>
      </div>
    </div>
  );
}
