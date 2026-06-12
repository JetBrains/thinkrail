import { useEffect } from "react";
import { getClient } from "@/api/index.ts";
import { createBoardApi } from "@/api/methods/board.ts";
import { createSessionApi, type SessionSummary } from "@/api/methods/sessions.ts";
import { useBoardStore } from "@/store/boardStore.ts";
import { useTicketRouteStore } from "@/store/ticketRouteStore.ts";
import { TicketInfo } from "./TicketInfo.tsx";
import { Button } from "@/components/ui/Button";
import "./BoardTicketPreview.css";

/** Right-panel preview of a board ticket. Loads the same data the ticket
 *  route does (ticket + plan + history + session summaries) into
 *  `ticketRouteStore` so the existing `TicketInfo` renders unchanged — but
 *  keeps the board in the center. "Go to ticket" enters the full route. */
export function BoardTicketPreview({ ticketId }: { ticketId: string }) {
  const setTicketId = useTicketRouteStore((s) => s.setTicketId);
  const setTicket = useTicketRouteStore((s) => s.setTicket);
  const setPlan = useTicketRouteStore((s) => s.setPlan);
  const setHistoryEntries = useTicketRouteStore((s) => s.setHistoryEntries);
  const setSessionSummaries = useTicketRouteStore((s) => s.setSessionSummaries);
  const clearRoute = useTicketRouteStore((s) => s.clear);

  const openTicket = useBoardStore((s) => s.openTicket);
  const setPreviewTicket = useBoardStore((s) => s.setPreviewTicket);

  useEffect(() => {
    clearRoute();
    setTicketId(ticketId);
    const board = createBoardApi(getClient());
    board
      .get(ticketId)
      .then((t) => {
        setTicket(t);
        if (t.implementationPlanPath) {
          board.getPlan(ticketId).then(setPlan).catch(() => {});
        }
      })
      .catch(() => {});
    board
      .getHistory(ticketId)
      .then((rows) => setHistoryEntries(rows))
      .catch(() => setHistoryEntries([]));
    createSessionApi(getClient())
      .list()
      .then((summaries) => {
        const map = new Map<string, SessionSummary>();
        for (const s of summaries) map.set(s.bonsaiSid, s);
        setSessionSummaries(map);
      })
      .catch(() => {});
    return () => {
      clearRoute();
    };
  }, [ticketId, clearRoute, setTicketId, setTicket, setPlan, setHistoryEntries, setSessionSummaries]);

  return (
    <div className="context-panel context-panel--ticket">
      <div className="context-panel__header">
        <span className="context-panel__mode-label">Ticket preview</span>
        <Button
          variant="primary"
          size="sm"
          onClick={() => openTicket(ticketId)}
          title="Open the full ticket"
        >
          Go to ticket {"↗"}
        </Button>
        <button
          className="board-preview-close"
          onClick={() => setPreviewTicket(null)}
          title="Close preview"
          aria-label="Close preview"
        >
          {"×"}
        </button>
      </div>
      <div className="context-panel__body context-panel__body--flush">
        <div className="left-panel-ticket-body">
          <TicketInfo />
        </div>
      </div>
    </div>
  );
}
