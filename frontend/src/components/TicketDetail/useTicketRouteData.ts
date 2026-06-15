import { useEffect, useMemo, useRef } from "react";
import { getClient } from "@/api/index.ts";
import { createBoardApi } from "@/api/methods/board.ts";
import { createSessionApi, type SessionSummary } from "@/api/methods/sessions.ts";
import { useSessionStore } from "@/store/sessionStore.ts";
import { useBoardStore } from "@/store/boardStore.ts";
import { useTicketRouteStore } from "@/store/ticketRouteStore.ts";

/**
 * Loads a ticket's data (ticket + history + session summaries) into the
 * singleton `ticketRouteStore` and keeps it fresh. Used by whatever surface is
 * showing the active ticket (the ticket tab in SessionPanel). Reloads when
 * `ticketId` changes and clears on unmount / when null.
 */
export function useTicketRouteData(ticketId: string | null): void {
  const setTicketId = useTicketRouteStore((s) => s.setTicketId);
  const setTicket = useTicketRouteStore((s) => s.setTicket);
  const setHistoryEntries = useTicketRouteStore((s) => s.setHistoryEntries);
  const setSessionSummaries = useTicketRouteStore((s) => s.setSessionSummaries);
  const clearRoute = useTicketRouteStore((s) => s.clear);

  const ticket = useTicketRouteStore((s) => s.ticket);
  const liveSessionsMap = useSessionStore((s) => s.sessions);

  // ── Mount / ticketId change: clear stale route state, fetch ticket ──
  useEffect(() => {
    clearRoute();
    if (!ticketId) return;
    setTicketId(ticketId);
    const api = createBoardApi(getClient());
    api.get(ticketId).then(setTicket).catch(() => {});
    return () => {
      clearRoute();
    };
  }, [ticketId, clearRoute, setTicketId, setTicket]);

  // ── Session summaries (kept up to date as the ticket gains sessions) ──
  useEffect(() => {
    if (!ticketId) return;
    createSessionApi(getClient())
      .list()
      .then((summaries) => {
        const map = new Map<string, SessionSummary>();
        for (const s of summaries) map.set(s.thinkrailSid, s);
        setSessionSummaries(map);
      })
      .catch(() => {});
  }, [ticketId, ticket?.sessionIds.length, setSessionSummaries]);

  // ── History (refetch when ticket.updated changes or session events grow) ──
  const boardSummary = useBoardStore((s) => (ticketId ? s.tickets.get(ticketId) : undefined));
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
    if (!ticketId) return;
    createBoardApi(getClient())
      .getHistory(ticketId)
      .then((rows) => setHistoryEntries(rows))
      .catch(() => setHistoryEntries([]));
  }, [ticketId, boardSummaryUpdated, totalSessionEvents, setHistoryEntries]);

  // ── Refetch ticket on board update ──
  const lastUpdated = useRef(boardSummary?.updated);
  useEffect(() => {
    if (!ticketId) return;
    if (!boardSummary || boardSummary.updated === lastUpdated.current) return;
    lastUpdated.current = boardSummary.updated;
    createBoardApi(getClient()).get(ticketId).then(setTicket).catch(() => {});
  }, [boardSummary?.updated, ticketId, setTicket]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Direct subscription to board/didChange + ticket/didChange for *this* ticket ──
  useEffect(() => {
    if (!ticketId) return;
    const client = getClient();
    const refetch = (p: unknown) => {
      const summary = p as { id?: string };
      if (!summary?.id || summary.id !== ticketId) return;
      createBoardApi(getClient()).get(ticketId).then(setTicket).catch(() => {});
    };
    const u1 = client.on("board/didChange", refetch);
    // ticket/didChange is emitted by publish_ticket_state (DAG stage mutations)
    const u2 = client.on("ticket/didChange", refetch);
    return () => { u1(); u2(); };
  }, [ticketId, setTicket]);
}
