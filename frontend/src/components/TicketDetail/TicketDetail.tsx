import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getClient } from "@/api/index.ts";
import { createBoardApi } from "@/api/methods/board.ts";
import { createSessionApi, type SessionSummary } from "@/api/methods/sessions.ts";
import { useSessionStore } from "@/store/sessionStore.ts";
import { useBoardStore } from "@/store/boardStore.ts";
import { useTicketRouteStore } from "@/store/ticketRouteStore.ts";
import { buildDefaultSessionConfig } from "@/utils/sessionConfig.ts";
import { SessionPanel } from "@/components/SessionPanel/SessionPanel.tsx";
import { PHASE_SKILLS } from "./TicketPhaseList.tsx";
import "./TicketDetail.css";

interface TicketDetailProps {
  ticketId: string;
}

/** Center-column host + lifecycle coordinator for the ticket route.
 *
 *  The visual three-panel layout (phase tree / chat / artifact preview) is
 *  composed at the AppShell level: LeftPanel renders the phase tree from
 *  `ticketRouteStore` when in ticket mode, ContextPanel renders the artifact
 *  preview, and this component owns the center column.
 *
 *  Responsibilities here:
 *    - Load ticket + plan + history + session summaries on mount/change and
 *      write them into ticketRouteStore so sibling panels can read.
 *    - Subscribe to `board/didChange` for this ticket.
 *    - Promote the center session id to global `activeSessionId` (so the
 *      Chrome / wider app reflect the active session).
 *    - Auto-create a stage-default draft for the ticket's current phase. */
export function TicketDetail({ ticketId }: TicketDetailProps) {
  const setTicketId = useTicketRouteStore((s) => s.setTicketId);
  const setTicket = useTicketRouteStore((s) => s.setTicket);
  const setPlan = useTicketRouteStore((s) => s.setPlan);
  const setHistoryEntries = useTicketRouteStore((s) => s.setHistoryEntries);
  const setSessionSummaries = useTicketRouteStore((s) => s.setSessionSummaries);
  const clearRoute = useTicketRouteStore((s) => s.clear);

  const ticket = useTicketRouteStore((s) => s.ticket);
  const centerSessionId = useTicketRouteStore((s) => s.centerSessionId);

  // Phase-default fallback for the center session: whichever session is
  // attached to this ticket's current phase. The explicit centerSessionId
  // (set when the user clicks a row) overrides this.
  const liveSessionsMap = useSessionStore((s) => s.sessions);
  const archivedSessionsList = useSessionStore((s) => s.archivedSessions);
  const sessionSummaries = useTicketRouteStore((s) => s.sessionSummaries);

  const phaseDefaultSid = useMemo(() => {
    if (!ticket) return null;
    const skill = PHASE_SKILLS[ticket.status];
    if (!skill) return null;
    // Collect all sids for this phase together with a "has real work"
    // signal so we can prefer a worked-on session over orphan drafts that
    // accumulate from past auto-create races. Live Session lacks updatedAt
    // so we fall back to startedAt for ordering live entries.
    const matches: { sid: string; isDraft: boolean; ts: number }[] = [];
    for (const sid of ticket.sessionIds) {
      const live = liveSessionsMap.get(sid);
      const archived = !live ? archivedSessionsList.find((a) => a.bonsaiSid === sid) : null;
      const summary = !live && !archived ? sessionSummaries.get(sid) : null;
      const skillId = live?.skillId ?? archived?.skillId ?? summary?.skillId ?? null;
      if (skillId !== skill) continue;
      const status = live?.status ?? archived?.result ?? summary?.status ?? "draft";
      const ts =
        live?.startedAt ??
        archived?.endedAt ??
        (summary?.updatedAt ? Date.parse(summary.updatedAt) : 0);
      matches.push({ sid, isDraft: status === "draft", ts: ts || 0 });
    }
    if (matches.length === 0) return null;
    matches.sort((a, b) => {
      if (a.isDraft !== b.isDraft) return a.isDraft ? 1 : -1;
      return b.ts - a.ts;
    });
    return matches[0].sid;
  }, [ticket, liveSessionsMap, archivedSessionsList, sessionSummaries]);

  const effectiveCenterSid = centerSessionId ?? phaseDefaultSid;

  // ── Mount: clear stale route state, set ticketId, fetch ticket + plan ──
  useEffect(() => {
    clearRoute();
    setTicketId(ticketId);
    const api = createBoardApi(getClient());
    api
      .get(ticketId)
      .then((t) => {
        setTicket(t);
        if (t.implementationPlanPath) {
          lastPlanPath.current = t.implementationPlanPath;
          api.getPlan(ticketId).then(setPlan).catch(() => {});
        }
      })
      .catch(() => {});
    return () => {
      clearRoute();
    };
  }, [ticketId, clearRoute, setTicketId, setTicket, setPlan]);

  // ── Session summaries (kept up to date as ticket gains sessions) ──
  // `summariesLoaded` gates the auto-create-draft effect below; without it
  // a page refresh would race ahead and spawn a duplicate draft each time
  // because the live sessions map starts empty and we'd think no phase
  // session exists yet.
  const [summariesLoaded, setSummariesLoaded] = useState(false);
  useEffect(() => {
    const api = createSessionApi(getClient());
    api
      .list()
      .then((summaries) => {
        const map = new Map<string, SessionSummary>();
        for (const s of summaries) map.set(s.bonsaiSid, s);
        setSessionSummaries(map);
        setSummariesLoaded(true);
      })
      .catch(() => setSummariesLoaded(true));
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
  const lastPlanPath = useRef<string | null>(null);
  useEffect(() => {
    if (!boardSummary || boardSummary.updated === lastUpdated.current) return;
    lastUpdated.current = boardSummary.updated;
    const api = createBoardApi(getClient());
    api
      .get(ticketId)
      .then((t) => {
        setTicket(t);
        if (t.implementationPlanPath && t.implementationPlanPath !== lastPlanPath.current) {
          lastPlanPath.current = t.implementationPlanPath;
          api.getPlan(ticketId).then(setPlan).catch(() => {});
        }
      })
      .catch(() => {});
  }, [boardSummary?.updated, ticketId, setTicket, setPlan]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Direct subscription to board/didChange for *this* ticket ──
  // Bypasses the boardStore selector chain so agent-driven changes (e.g.
  // SuggestDescription with apply=true) refresh the local ticket without a
  // separate broadcast hop.
  useEffect(() => {
    const client = getClient();
    const unsub = client.on("board/didChange", (p: unknown) => {
      const summary = p as { id?: string };
      if (!summary?.id || summary.id !== ticketId) return;
      const api = createBoardApi(getClient());
      api.get(ticketId).then(setTicket).catch(() => {});
    });
    return () => { unsub(); };
  }, [ticketId, setTicket]);

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

  // ── Auto-create a stage-default draft for the ticket's current phase ──
  // Fires AT MOST ONCE per ticket mount. We deliberately exclude
  // `ticket.status` from the deps and gate on `autoCreateRanRef` because
  // the user clicking Run on a future phase (via TicketInfo.handleStartSession)
  // advances `ticket.status` and would otherwise race this effect — two
  // concurrent `createDraft` calls then attach two sessions for the same
  // phase. handleStartSession is the sole creator for user-driven phase
  // advancement; auto-create is for "user just opened a ticket and there's
  // no session for the current phase yet".
  //
  // Gated on summariesLoaded so a page refresh doesn't race ahead and spawn
  // a duplicate draft while the persisted sessions are still being
  // discovered. We also consult summaries + archived (not just the live
  // sessions Map) so a known-on-disk session counts as "already exists".
  const autoCreateRanRef = useRef<string | null>(null);
  useEffect(() => {
    if (!ticket) return;
    if (!summariesLoaded) return;
    if (autoCreateRanRef.current === ticket.id) return;
    const skill = PHASE_SKILLS[ticket.status];
    if (!skill) {
      autoCreateRanRef.current = ticket.id;
      return;
    }
    if (ticket.skippedPhases?.includes(ticket.status)) {
      autoCreateRanRef.current = ticket.id;
      return;
    }

    const hasMatchingSession = (): boolean => {
      const live = useSessionStore.getState().sessions;
      for (const [, s] of live) {
        if (s.ticketId === ticket.id && s.skillId === skill) return true;
      }
      const archived = useSessionStore.getState().archivedSessions;
      for (const sid of ticket.sessionIds) {
        const arc = archived.find((a) => a.bonsaiSid === sid);
        const sum = sessionSummaries.get(sid);
        const sk = arc?.skillId ?? sum?.skillId ?? null;
        if (sk === skill) return true;
      }
      return false;
    };

    if (hasMatchingSession()) {
      autoCreateRanRef.current = ticket.id;
      return;
    }

    // Mark BEFORE the async boundary so any re-render inside this mount
    // (e.g. status advancing while createDraft is in-flight) doesn't
    // re-enter this branch.
    autoCreateRanRef.current = ticket.id;

    let cancelled = false;
    (async () => {
      try {
        const config = await buildDefaultSessionConfig();
        if (cancelled) return;
        if (hasMatchingSession()) return;
        await useSessionStore.getState().createDraft({
          specIds: [],
          config,
          name: `${ticket.title} · ${ticket.status}`,
          skillId: skill,
          ticketId: ticket.id,
          kind: "stage-default",
        });
      } catch (e) {
        console.error("[TicketDetail] auto-draft failed:", e);
      }
    })();
    return () => { cancelled = true; };
  }, [ticket?.id, summariesLoaded, sessionSummaries]); // eslint-disable-line react-hooks/exhaustive-deps

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
        <p>No session for this phase yet.</p>
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
