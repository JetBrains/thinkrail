import { useCallback, useEffect, useMemo, useState } from "react";
import type { Ticket, TicketStatus, TicketType } from "@/types/board.ts";
import { useBoardStore } from "@/store/boardStore.ts";
import { useSessionStore } from "@/store/sessionStore.ts";
import { useTicketRouteStore } from "@/store/ticketRouteStore.ts";
import { StaleRefsBanner } from "@/components/shared/StaleRefsBanner.tsx";
import { timeAgo } from "@/utils/format.ts";
import { TicketPhaseList, PHASE_ORDER, PHASE_SKILLS, STATE_ORDER, type PhaseListEmit } from "./TicketPhaseList.tsx";
import { MarkdownEditor } from "@/components/MarkdownEditor/MarkdownEditor.tsx";
import { deriveSessionTodoState, type TodoSnapshot } from "./sessionTodoState.ts";
import { buildDefaultSessionConfig } from "@/utils/sessionConfig.ts";
import { getClient } from "@/api/index.ts";
import { createBoardApi } from "@/api/methods/board.ts";
import type { PlanModel } from "./planTypes.ts";

const SKILL_TO_PHASE: Partial<Record<string, TicketStatus>> = {
  "ticket-product-design": "product-design",
  "ticket-technical-design": "technical-design",
  "ticket-amend-specs": "amend-specs",
  "ticket-implementation-plan": "implementation-plan",
  "ticket-implement": "implementing",
};

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
  const plan = useTicketRouteStore((s) => s.plan) as PlanModel | null;
  const historyEntries = useTicketRouteStore((s) => s.historyEntries);
  const sessionSummaries = useTicketRouteStore((s) => s.sessionSummaries);
  const setTicket = useTicketRouteStore((s) => s.setTicket);
  const setCenterSessionId = useTicketRouteStore((s) => s.setCenterSessionId);
  const setSelectedArtifact = useTicketRouteStore((s) => s.setSelectedArtifact);
  const requestScroll = useTicketRouteStore((s) => s.requestScroll);

  const liveSessionsMap = useSessionStore((s) => s.sessions);
  const archivedSessionsList = useSessionStore((s) => s.archivedSessions);
  const createDraft = useSessionStore((s) => s.createDraft);
  const restoreSession = useSessionStore((s) => s.restoreSession);

  const updateTicket = useBoardStore((s) => s.updateTicket);
  const updateTicketStore = useBoardStore((s) => s.updateTicket);
  const getStaleTicketRefs = useBoardStore((s) => s.getStaleTicketRefs);
  const fixStaleTicketRefs = useBoardStore((s) => s.fixStaleTicketRefs);

  const [descHeight, setDescHeight] = useState(140);
  const [editingDescription, setEditingDescription] = useState(false);
  const [descDraft, setDescDraft] = useState(ticket?.body ?? "");
  const [editTitle, setEditTitle] = useState(ticket?.title ?? "");

  useEffect(() => setDescDraft(ticket?.body ?? ""), [ticket?.body]);
  useEffect(() => setEditTitle(ticket?.title ?? ""), [ticket?.title]);

  // ── Derived: phase → session id ─────────────────────────────────────
  const phaseSessionIds = useMemo<Partial<Record<TicketStatus, string>>>(() => {
    if (!ticket) return {};
    const skillToPhase = new Map<string, TicketStatus>();
    for (const phase of PHASE_ORDER) {
      const skill = PHASE_SKILLS[phase];
      if (skill) skillToPhase.set(skill, phase);
    }
    const out: Partial<Record<TicketStatus, string>> = {};
    for (const sid of ticket.sessionIds) {
      const live = liveSessionsMap.get(sid);
      const archived = !live ? archivedSessionsList.find((a) => a.bonsaiSid === sid) : null;
      const summary = !live && !archived ? sessionSummaries.get(sid) : null;
      const skillId = live?.skillId ?? archived?.skillId ?? summary?.skillId ?? null;
      if (!skillId) continue;
      const phase = skillToPhase.get(skillId);
      if (!phase) continue;
      if (out[phase] == null) out[phase] = sid;
    }
    return out;
  }, [ticket, liveSessionsMap, archivedSessionsList, sessionSummaries]);

  const phaseSessionArtifacts = useMemo<Partial<Record<TicketStatus, { path: string; label?: string }[]>>>(() => {
    const out: Partial<Record<TicketStatus, { path: string; label?: string }[]>> = {};
    for (const phase of PHASE_ORDER) {
      const sid = phaseSessionIds[phase];
      if (!sid) continue;
      const live = liveSessionsMap.get(sid);
      const artifacts = live?.artifacts ?? [];
      out[phase] = artifacts.map((a) => ({ path: a.path, label: a.label ?? undefined }));
    }
    return out;
  }, [phaseSessionIds, liveSessionsMap]);

  const planSteps = useMemo(() => {
    const milestones = (plan?.milestones as { steps?: { number: number; title: string; status: string; sessionId?: string | null }[] }[]) ?? [];
    return milestones.flatMap((m) => m.steps ?? []);
  }, [plan]);

  const historyCountByPhase = useMemo(() => {
    const out: Partial<Record<TicketStatus, number>> = {};
    for (const e of historyEntries) {
      if (!e.skill) continue;
      const phase = SKILL_TO_PHASE[e.skill];
      if (!phase) continue;
      out[phase] = (out[phase] ?? 0) + 1;
    }
    return out;
  }, [historyEntries]);

  const amendSpecsFiles = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const e of historyEntries) {
      if (e.skill !== "ticket-amend-specs") continue;
      if (!e.filePath || seen.has(e.filePath)) continue;
      seen.add(e.filePath);
      out.push(e.filePath);
    }
    return out;
  }, [historyEntries]);

  const knownSessionIds = useMemo(
    () => new Set<string>(sessionSummaries.keys()),
    [sessionSummaries],
  );

  // Tasks (n/m) source-of-truth precedence:
  //   1. Live session events when the session is loaded — carries
  //      `touchByKey` so the task list can scroll the chat to the event
  //      that flipped a task's status.
  //   2. Persisted summary snapshot from the backend — survives reload
  //      and works for sessions we haven't loaded into memory yet.
  // Without (2), Tasks sub-rows would only appear after the user clicked
  // into the session. See feedback_backend_comprehensive.
  const sessionTodoState = useMemo<Map<string, TodoSnapshot>>(() => {
    const out = new Map<string, TodoSnapshot>();
    for (const [sid, sess] of liveSessionsMap) {
      const snap = deriveSessionTodoState(sess.events ?? []);
      if (snap) out.set(sid, snap);
    }
    for (const [sid, summary] of sessionSummaries) {
      if (out.has(sid)) continue;
      const todos = summary.todos ?? [];
      if (todos.length === 0) continue;
      out.set(sid, { todos, touchByKey: new Map() });
    }
    return out;
  }, [liveSessionsMap, sessionSummaries]);

  const planDone = planSteps.filter((s) => s.status === "done").length;

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

  // ── Phase-list event dispatch ──
  const handleSelectPanel = useCallback((p: PhaseListEmit) => {
    if (p.type === "session") {
      setCenterSessionId(p.sessionId);
      return;
    }
    if (p.type === "artifact") {
      if (p.kind === "implementation_plan") {
        setSelectedArtifact({ kind: "plan" });
      } else if (p.kind === "history") {
        setSelectedArtifact({ kind: "history" });
      } else {
        setSelectedArtifact({ kind: "canonical", artifact: p.kind });
      }
      return;
    }
    if (p.type === "plan") {
      setSelectedArtifact({ kind: "plan" });
      return;
    }
    if (p.type === "file") {
      setSelectedArtifact({ kind: "file", filePath: p.filePath });
      return;
    }
    if (p.type === "history") {
      setSelectedArtifact({ kind: "history", phaseFilter: p.phaseFilter });
      return;
    }
  }, [setCenterSessionId, setSelectedArtifact]);

  const handleScrollSessionToEvent = useCallback((sid: string, eventIndex: number) => {
    setCenterSessionId(sid);
    requestAnimationFrame(() => requestScroll(sid, eventIndex));
  }, [setCenterSessionId, requestScroll]);

  const handleStartSession = useCallback(
    async (skillId: string, opts?: { previewPath?: string }) => {
      if (!ticket) return;

      const skillToPhase = new Map<string, TicketStatus>();
      for (const p of PHASE_ORDER) {
        const sk = PHASE_SKILLS[p];
        if (sk) skillToPhase.set(sk, p);
      }
      const phase = skillToPhase.get(skillId);

      let workingTicket = ticket;
      if (phase && STATE_ORDER[ticket.status] < STATE_ORDER[phase]) {
        try {
          const updated = await updateTicketStore(ticket.id, { status: phase });
          workingTicket = updated as Ticket;
          setTicket(workingTicket);
        } catch (e) {
          console.error("[TicketInfo] Failed to advance ticket status:", e);
        }
      }

      const existingSid = phase ? phaseSessionIds[phase] : undefined;
      if (existingSid) {
        if (!liveSessionsMap.has(existingSid)) {
          try {
            await restoreSession(existingSid, { noTab: true });
          } catch (e) {
            console.error("[TicketInfo] Failed to restore session:", e);
          }
        }
        setCenterSessionId(existingSid);
        if (opts?.previewPath) {
          useSessionStore.getState().setPreviewPath(existingSid, opts.previewPath);
        }
        return;
      }

      const isImplement = skillId === "ticket-implement";
      const baseConfig = await buildDefaultSessionConfig();
      const sid = await createDraft({
        specIds: isImplement ? workingTicket.linkedSpecIds : [],
        config: baseConfig,
        name: isImplement
          ? `Implement: ${workingTicket.title}`
          : `${skillId.replace("ticket-", "")}: ${workingTicket.title}`,
        skillId,
        ticketId: workingTicket.id,
      });
      // Backend attaches the session silently; refetch so `ticket.sessionIds`
      // includes the new sid and the sidebar's Continue button shows.
      try {
        const refreshed = await createBoardApi(getClient()).get(workingTicket.id);
        setTicket(refreshed);
      } catch (e) {
        console.error("[TicketInfo] Failed to refresh ticket after createDraft:", e);
      }
      setCenterSessionId(sid);
      if (opts?.previewPath) {
        useSessionStore.getState().setPreviewPath(sid, opts.previewPath);
      }
    },
    [ticket, createDraft, phaseSessionIds, liveSessionsMap, restoreSession, updateTicketStore, setTicket, setCenterSessionId],
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
              className={`ticket-header-badge ticket-header-badge--${ticket.status}`}
              title="Set via the Progress list"
            >
              {ticket.status}
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
          {planSteps.length > 0 && (
            <span>{planDone}/{planSteps.length} steps</span>
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
              <button onClick={handleSaveDescription}>Save</button>
              <button onClick={handleCancelDescription}>Cancel</button>
            </div>
          )}
        </div>
        {editingDescription ? (
          <div style={{ height: descHeight, minHeight: 60 }}>
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
              <div className="ticket-description-preview-text">{ticket.body}</div>
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
      <TicketPhaseList
        ticket={ticket}
        plan={plan ?? null}
        phaseSessionIds={phaseSessionIds}
        phaseSessionArtifacts={phaseSessionArtifacts}
        historyCountByPhase={historyCountByPhase}
        amendSpecsFiles={amendSpecsFiles}
        sessionTodoState={sessionTodoState}
        onStartSession={handleStartSession}
        onSelectPanel={handleSelectPanel}
        onScrollSessionToEvent={handleScrollSessionToEvent}
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
