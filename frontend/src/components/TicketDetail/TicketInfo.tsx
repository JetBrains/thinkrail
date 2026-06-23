import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { Ticket, TicketType, OrchestrationConfig, WorkNode } from "@/types/board.ts";
import { NodeStatus, SessionStatus, isStreaming } from "@/constants/status.ts";
import { useBoardStore } from "@/store/boardStore.ts";
import { useSessionStore } from "@/store/sessionStore.ts";
import { useTicketRouteStore } from "@/store/ticketRouteStore.ts";
import { Dropdown } from "@/components/shared/Dropdown.tsx";
import { getClient } from "@/api/index.ts";
import { createBoardApi, type HistoryEntry } from "@/api/methods/board.ts";
import { StaleRefsBanner } from "@/components/shared/StaleRefsBanner.tsx";
import { timeAgo } from "@/utils/format.ts";
import { deriveLifecycle, findStageNode, latestNodeSessionId } from "@/utils/lifecycle.ts";
import { StageGraph } from "./StageGraph.tsx";
import { OrchestrationControls } from "./OrchestrationControls.tsx";
import { ChatMarkdown } from "@/components/ChatStream/ChatMarkdown.tsx";
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

  const [editTitle, setEditTitle] = useState(ticket?.title ?? "");

  useEffect(() => setEditTitle(ticket?.title ?? ""), [ticket?.title]);

  const knownSessionIds = useMemo(
    () => new Set<string>(sessionSummaries.keys()),
    [sessionSummaries],
  );

  // Group history entries by the file they changed; files ordered by their
  // most recent change (highest entry index) so recent activity sits on top.
  const historyByFile = useMemo(() => {
    const map = new Map<string, HistoryEntry[]>();
    for (const e of historyEntries) {
      const key = (e.filePath || "(unknown file)").replace(/^\.\//, "");
      const arr = map.get(key);
      if (arr) arr.push(e);
      else map.set(key, [e]);
    }
    return [...map.entries()].sort(
      (a, b) => Math.max(...b[1].map((e) => e.index)) - Math.max(...a[1].map((e) => e.index)),
    );
  }, [historyEntries]);

  const lifecycle = useMemo(
    () => deriveLifecycle(ticket?.stages ?? []),
    [ticket?.stages],
  );

  // When the ticket is orchestrated, the orchestrator is the outermost level:
  // render a synthetic root WorkNode whose children are the stages, so the
  // progress tree reads Orchestrator → stages → steps → runs. Without an
  // orchestrator the stages render flat (top-level), as before.
  const orchSid = ticket?.orchestrator?.sessionId ?? null;
  const stageNodes = useMemo<WorkNode[]>(() => {
    const stages = ticket?.stages ?? [];
    if (!orchSid) return stages;
    const live = liveSessionsMap.get(orchSid);
    const archived = !live ? archivedSessionsList.find((a) => a.thinkrailSid === orchSid) : null;
    const raw = live?.status ?? archived?.result ?? SessionStatus.Interrupted;
    const status: WorkNode["status"] =
      isStreaming(raw) ? NodeStatus.Running
        : raw === SessionStatus.Done ? NodeStatus.Done
        : raw === SessionStatus.Error ? NodeStatus.Failed : NodeStatus.Pending;
    const root = {
      id: "__orchestrator__",
      title: "Orchestrator",
      status,
      runs: [{ kind: "session", sessionId: orchSid }],
      children: stages,
    } as unknown as WorkNode;
    return [root];
  }, [ticket?.stages, orchSid, liveSessionsMap, archivedSessionsList]);

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
    async (type: TicketType) => {
      if (!ticket) return;
      const updated = await updateTicket(ticket.id, { type });
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
            <Dropdown<TicketType>
              className={`ticket-header-badge ticket-header-badge--${ticket.type}`}
              value={ticket.type}
              options={TYPE_OPTIONS.map((t) => ({ value: t, label: t }))}
              onChange={handleTypeChange}
              align="right"
              ariaLabel="Ticket type"
            />
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

      {/* ── Description (read-only rendered markdown) ── */}
      <div className="ticket-section">
        <div className="ticket-section-header">
          <span className="ticket-section-title">Description</span>
        </div>
        {ticket.body ? (
          <div className="ticket-description-preview">
            <ChatMarkdown content={ticket.body} />
          </div>
        ) : (
          <div className="ticket-description-empty">
            No description yet. Run <code>ticket-product-design</code> to populate it.
          </div>
        )}
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

      <StageGraph
        state={{ ...ticket, stages: stageNodes } as unknown as Parameters<typeof StageGraph>[0]["state"]}
        onFocusNode={(nodeId) => {
          // Clicking a stage (or the orchestrator root) opens its latest session.
          const node = findStageNode(stageNodes, nodeId);
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

      <div className="ticket-history-section">
        <div
          className={`ticket-history-row ${historyEntries.length === 0 ? "ticket-history-row--empty" : ""}`}
          onClick={() => setSelectedArtifact({ kind: "history" })}
          title={
            historyEntries.length === 0
              ? "No changes yet — edit a spec to start a history"
              : "Open full history"
          }
        >
          <span className="ticket-history-row-title">History</span>
          <span className="ticket-history-row-count">({historyEntries.length})</span>
        </div>
        {historyEntries.length > 0 && (
          <ul className="ticket-history-mini">
            {historyByFile.map(([file, entries]) => (
              <HistoryFileGroup
                key={file}
                file={file}
                entries={entries}
                onOpenStep={(index) => setSelectedArtifact({ kind: "history", expandIndex: index })}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** One file in the overview history list. Collapsed by default; expanding
 *  reveals the steps (#index) that changed this file, newest first. */
function HistoryFileGroup({
  file,
  entries,
  onOpenStep,
}: {
  file: string;
  entries: HistoryEntry[];
  onOpenStep: (index: number) => void;
}) {
  const [open, setOpen] = useState(false);
  // Last two path segments so same-named files (e.g. two README.md) are distinct.
  const name = file.split("/").filter(Boolean).slice(-2).join("/") || file;
  const steps = [...entries].sort((a, b) => b.index - a.index);

  return (
    <li className="ticket-history-file">
      <div className="ticket-history-file-head" title={file} onClick={() => setOpen((v) => !v)}>
        <span className="ticket-history-file-chev">
          {open ? (
            <ChevronDown size={14} strokeWidth={1.5} aria-hidden="true" />
          ) : (
            <ChevronRight size={14} strokeWidth={1.5} aria-hidden="true" />
          )}
        </span>
        <span className="ticket-history-file-name">{name}</span>
        <span className="ticket-history-file-count">{entries.length}</span>
      </div>
      {open && (
        <ol className="ticket-history-file-steps">
          {steps.map((e) => (
            <li
              key={e.index}
              className="ticket-history-mini-item"
              title={e.rationale ?? e.section ?? undefined}
              onClick={() => onOpenStep(e.index)}
            >
              <span className="ticket-history-mini-num">#{e.index}</span>
              <span className="ticket-history-mini-name">
                {e.section || e.rationale || e.timestamp.slice(0, 19).replace("T", " ")}
              </span>
            </li>
          ))}
        </ol>
      )}
    </li>
  );
}
