import { useCallback, useEffect, useMemo, useRef } from "react";
import { getClient } from "@/api/index.ts";
import { createBoardApi } from "@/api/methods/board.ts";
import { createSessionApi, type SessionSummary } from "@/api/methods/sessions.ts";
import { useSessionStore } from "@/store/sessionStore.ts";
import { useBoardStore } from "@/store/boardStore.ts";
import { useTicketStateStore } from "@/store/ticketStateStore.ts";
import { useTicketRouteStore } from "@/store/ticketRouteStore.ts";
import { SessionPanel } from "@/components/SessionPanel/SessionPanel.tsx";
import type { WorkNode } from "@/types/rpc-methods.ts";
import "./TicketDetail.css";

export function collectRunningStageSessions(stages: WorkNode[]): Set<string> {
  const result = new Set<string>();
  for (const node of stages) {
    if (node.status === "running" && node.runs && node.runs.length > 0) {
      const latest = node.runs[node.runs.length - 1];
      if (latest.kind === "session" && latest.sessionId) {
        result.add(latest.sessionId);
      }
    }
    if (node.children) {
      for (const sid of collectRunningStageSessions(node.children)) {
        result.add(sid);
      }
    }
  }
  return result;
}

interface TicketDetailProps {
  ticketId: string;
}

/** Center-column host + lifecycle coordinator for the ticket route.
 *
 *  The visual three-panel layout (stage graph / chat / artifact preview) is
 *  composed at the AppShell level: LeftPanel renders the stage graph from
 *  `ticketRouteStore` + `ticketStateStore`, ContextPanel renders the artifact
 *  preview, and this component owns the center column.
 *
 *  Responsibilities here:
 *    - Load ticket + history + session summaries on mount/change and write
 *      them into ticketRouteStore so sibling panels can read.
 *    - Seed + keep the TicketState aggregate warm.
 *    - Promote the center session (explicit selection, else the orchestrator
 *      session) to global `activeSessionId`. */
export function TicketDetail({ ticketId }: TicketDetailProps) {
  const setTicketId = useTicketRouteStore((s) => s.setTicketId);
  const setTicket = useTicketRouteStore((s) => s.setTicket);
  const setHistoryEntries = useTicketRouteStore((s) => s.setHistoryEntries);
  const setSessionSummaries = useTicketRouteStore((s) => s.setSessionSummaries);
  const clearRoute = useTicketRouteStore((s) => s.clear);

  const ticket = useTicketRouteStore((s) => s.ticket);
  const centerSessionId = useTicketRouteStore((s) => s.centerSessionId);
  const setCenterSessionId = useTicketRouteStore((s) => s.setCenterSessionId);

  const ticketState = useTicketStateStore((s) => (ticketId ? s.states.get(ticketId) : undefined));

  // The center session defaults to the ticket's orchestrator session; an
  // explicit selection (clicking a stage node) overrides it.
  const effectiveCenterSid = centerSessionId ?? (ticket?.orchestrator?.sessionId ?? null);

  const liveSessionsMap = useSessionStore((s) => s.sessions);
  const restoreSession = useSessionStore((s) => s.restoreSession);

  // ── Mount: clear stale route state, set ticketId, fetch ticket ──
  useEffect(() => {
    clearRoute();
    setTicketId(ticketId);
    const api = createBoardApi(getClient());
    api.get(ticketId).then(setTicket).catch(() => {});
    return () => {
      clearRoute();
    };
  }, [ticketId, clearRoute, setTicketId, setTicket]);

  // ── Session summaries (kept up to date as the ticket gains sessions) ──
  useEffect(() => {
    const api = createSessionApi(getClient());
    api
      .list()
      .then((summaries) => {
        const map = new Map<string, SessionSummary>();
        for (const s of summaries) map.set(s.thinkrailSid, s);
        setSessionSummaries(map);
      })
      .catch(() => {});
  }, [ticketId, ticket?.sessionIds.length, setSessionSummaries]);

  // ── History (refetches when ticket.updated changes or session events grow) ──
  const boardSummary = useBoardStore((s) => s.tickets.get(ticketId));
  const boardSummaryUpdated = boardSummary?.updated;

  const totalSessionEvents = useMemo(() => {
    if (!ticket) return 0;
    let n = 0;
    for (const sid of ticket.sessionIds) {
      n += liveSessionsMap.get(sid)?.events?.length ?? 0;
    }
    return n;
  }, [ticket, liveSessionsMap]);

  useEffect(() => {
    const api = createBoardApi(getClient());
    api
      .getHistory(ticketId)
      .then((rows) => setHistoryEntries(rows))
      .catch(() => setHistoryEntries([]));
  }, [ticketId, boardSummaryUpdated, totalSessionEvents, setHistoryEntries]);

  // ── Refetch ticket on board update ──
  const lastUpdated = useRef(boardSummary?.updated);
  useEffect(() => {
    if (!boardSummary || boardSummary.updated === lastUpdated.current) return;
    lastUpdated.current = boardSummary.updated;
    const api = createBoardApi(getClient());
    api.get(ticketId).then(setTicket).catch(() => {});
  }, [boardSummary?.updated, ticketId, setTicket]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Direct subscription to board/didChange + ticket/didChange for *this* ticket ──
  // Bypasses the boardStore selector chain so agent-driven changes (e.g.
  // SuggestDescription with apply=true, propose_pipeline) refresh the local
  // ticket without a separate broadcast hop.
  useEffect(() => {
    const client = getClient();
    const refetch = (p: unknown) => {
      const summary = p as { id?: string };
      if (!summary?.id || summary.id !== ticketId) return;
      createBoardApi(getClient()).get(ticketId).then(setTicket).catch(() => {});
    };
    const u1 = client.on("board/didChange", refetch);
    // ticket/didChange is emitted by publish_ticket_state (DAG mutations)
    const u2 = client.on("ticket/didChange", refetch);
    return () => { u1(); u2(); };
  }, [ticketId, setTicket]);

  // ── Seed + keep the TicketState aggregate warm for this ticket ──
  // The aggregate is updated live via ticket/didChange (wired in wireEvents);
  // here we just seed it on mount so an open ticket has a rev-synced snapshot.
  useEffect(() => {
    useTicketStateStore.getState().fetch(ticketId).catch(() => {});
  }, [ticketId]);

  // ── Eagerly restore completed stage sessions ──
  // Loads all sessions referenced in the stage graph into the session store
  // so their artifacts immediately populate the right-panel artifact bar
  // without requiring the user to click each stage first.
  const restoredStageSidsRef = useRef<Set<string>>(new Set());
  useEffect(() => { restoredStageSidsRef.current = new Set(); }, [ticketId]);

  useEffect(() => {
    if (!ticketState?.stages) return;
    const collectSids = (nodes: WorkNode[]): string[] => {
      const sids: string[] = [];
      for (const node of nodes) {
        for (const run of node.runs ?? []) {
          const sid = run.sessionId ?? run.orchestratorSid;
          if (sid) sids.push(sid);
        }
        sids.push(...collectSids(node.children ?? []));
      }
      return sids;
    };
    for (const sid of new Set(collectSids(ticketState.stages))) {
      if (restoredStageSidsRef.current.has(sid)) continue;
      restoredStageSidsRef.current.add(sid);
      if (!liveSessionsMap.has(sid)) {
        restoreSession(sid, { noTab: true }).catch(() => {});
      }
    }
  }, [ticketState, liveSessionsMap, restoreSession]);

  // ── Auto-focus running stage sessions ──
  // When a stage node transitions to running with a session-kind run, focus it
  // in the center column. When that same session finishes, revert to the
  // orchestrator by clearing centerSessionId (if the user hasn't navigated away).
  const prevRunningRef = useRef<Set<string>>(new Set());
  const autoFocusedRef = useRef<string | null>(null);
  const seededRef = useRef(false);

  useEffect(() => {
    prevRunningRef.current = new Set();
    autoFocusedRef.current = null;
    seededRef.current = false;
  }, [ticketId]);

  useEffect(() => {
    if (!ticketState) return;
    const running = collectRunningStageSessions(ticketState.stages ?? []);

    if (!seededRef.current) {
      seededRef.current = true;
      prevRunningRef.current = running;
      if (running.size > 0) {
        const lastRunningSid = [...running][running.size - 1];
        autoFocusedRef.current = lastRunningSid;
        setCenterSessionId(lastRunningSid);
      }
      return;
    }

    const prevRunning = prevRunningRef.current;
    const newly = [...running].filter((s) => !prevRunning.has(s));

    if (newly.length > 0) {
      const sid = newly[newly.length - 1];
      autoFocusedRef.current = sid;
      setCenterSessionId(sid);
    } else if (
      autoFocusedRef.current !== null &&
      !running.has(autoFocusedRef.current) &&
      centerSessionId === autoFocusedRef.current
    ) {
      setCenterSessionId(null);
      autoFocusedRef.current = null;
    }

    prevRunningRef.current = running;
  }, [ticketState, centerSessionId, setCenterSessionId]);

  // ── Promote center session to global activeSessionId ──
  // ChatStream / Chrome / agent-context consumers read from activeSessionId.
  // We restore the previous value on unmount so leaving the ticket route
  // doesn't leave the global pointer dangling.
  const lastSetSidRef = useRef<string | null>(null);
  useEffect(() => {
    if (!effectiveCenterSid) return;
    useSessionStore.setState({ activeSessionId: effectiveCenterSid });
    lastSetSidRef.current = effectiveCenterSid;
  }, [effectiveCenterSid]);
  useEffect(() => {
    return () => {
      const sid = lastSetSidRef.current;
      if (sid && useSessionStore.getState().activeSessionId === sid) {
        useSessionStore.setState({ activeSessionId: null });
      }
    };
  }, []);

  // Agent-suggested ticket description (SuggestDescription) updates the
  // ticket body, not the markdown file. Ticket-route-only behaviour, so
  // it's threaded through SessionPanel as a prop rather than baked into
  // ChatStream's globals.
  const ticketIdForCallback = ticket?.id;
  const handleApplyDescription = useCallback(
    async (text: string) => {
      if (!ticketIdForCallback) return;
      try {
        await createBoardApi(getClient()).update(ticketIdForCallback, { body: text });
      } catch (e) {
        console.error("[TicketDetail] Failed to apply description:", e);
      }
    },
    [ticketIdForCallback],
  );

  if (!ticket) {
    return <div className="td-center-empty">Loading ticket...</div>;
  }

  if (!effectiveCenterSid) {
    return (
      <div className="td-center-empty">
        <p>No orchestrator session yet.</p>
      </div>
    );
  }

  return (
    <SessionPanel
      embeddedSid={effectiveCenterSid}
      onApplyDescription={handleApplyDescription}
    />
  );
}
