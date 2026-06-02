import { create } from "zustand";
import type { HistoryEntry } from "@/api/methods/board.ts";
import type { SessionSummary } from "@/api/methods/sessions.ts";
import type { Ticket } from "@/types/board.ts";
import type { SelectedArtifact } from "@/components/TicketDetail/useTicketArtifacts.ts";

/** Ephemeral, ticket-route-scoped UI + data state.
 *
 *  This slice is the coordination surface between the three ticket-route
 *  panels (LeftPanel → TicketInfo, centre → SessionPanel embedded via
 *  TicketDetail, ContextPanel → TicketPreviewPanel) that live in different
 *  parts of the AppShell tree. It is loaded by the TicketDetail coordinator
 *  on mount and cleared on unmount; nothing here is persisted.
 *
 *  - Raw data (ticket, plan, historyEntries, sessionSummaries) is written
 *    by TicketDetail's existing effects.
 *  - Coordination state (centerSessionId, selectedArtifact, pendingScroll)
 *    is written by the consumer panels and read by their siblings.
 */
interface TicketRouteState {
  ticketId: string | null;
  ticket: Ticket | null;
  plan: Record<string, unknown> | null;
  historyEntries: HistoryEntry[];
  sessionSummaries: Map<string, SessionSummary>;

  centerSessionId: string | null;
  selectedArtifact: SelectedArtifact | null;
  /** SessionPanel (centre, embedded mode) consumes & clears. Used to wire
   *  phase-list "open in chat" clicks to a ChatStream scroll-to-event. */
  pendingScroll: { sessionId: string; eventIndex: number } | null;

  setTicketId: (id: string | null) => void;
  setTicket: (t: Ticket | null) => void;
  setPlan: (p: Record<string, unknown> | null) => void;
  setHistoryEntries: (rows: HistoryEntry[]) => void;
  setSessionSummaries: (m: Map<string, SessionSummary>) => void;
  setCenterSessionId: (sid: string | null) => void;
  setSelectedArtifact: (a: SelectedArtifact | null) => void;
  requestScroll: (sid: string, eventIndex: number) => void;
  consumeScroll: () => void;
  clear: () => void;
}

const EMPTY: Omit<
  TicketRouteState,
  | "setTicketId"
  | "setTicket"
  | "setPlan"
  | "setHistoryEntries"
  | "setSessionSummaries"
  | "setCenterSessionId"
  | "setSelectedArtifact"
  | "requestScroll"
  | "consumeScroll"
  | "clear"
> = {
  ticketId: null,
  ticket: null,
  plan: null,
  historyEntries: [],
  sessionSummaries: new Map(),
  centerSessionId: null,
  selectedArtifact: null,
  pendingScroll: null,
};

export const useTicketRouteStore = create<TicketRouteState>((set) => ({
  ...EMPTY,
  setTicketId: (ticketId) => set({ ticketId }),
  setTicket: (ticket) => set({ ticket }),
  setPlan: (plan) => set({ plan }),
  setHistoryEntries: (historyEntries) => set({ historyEntries }),
  setSessionSummaries: (sessionSummaries) => set({ sessionSummaries }),
  setCenterSessionId: (centerSessionId) => set({ centerSessionId }),
  setSelectedArtifact: (selectedArtifact) => set({ selectedArtifact }),
  requestScroll: (sessionId, eventIndex) =>
    set({ pendingScroll: { sessionId, eventIndex } }),
  consumeScroll: () => set({ pendingScroll: null }),
  clear: () => set({ ...EMPTY }),
}));
