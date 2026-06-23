import { create } from "zustand";
import { STORAGE_PREFIX } from "@/constants/branding.ts";
import { persist, createJSONStorage } from "zustand/middleware";
import type {
  Ticket,
  TicketSummary,
  TicketType,
} from "@/types/board.ts";
import { getClient } from "@/api/index.ts";
import { createBoardApi } from "@/api/methods/board.ts";
import { deriveLifecycle } from "@/utils/lifecycle.ts";
import { useSpecStore } from "./specStore.ts";
import { useSessionStore } from "./sessionStore.ts";
import { useUiStore } from "./uiStore.ts";
import { useFileStore } from "./fileStore.ts";
import { findStaleSpecIds, findStaleSessionIds } from "@/utils/staleRefs.ts";

/** Project a full Ticket onto the board's TicketSummary: drop body, drop the
 *  stages DAG, and derive the coarse lifecycle from those stages. */
function toSummary(t: Ticket): TicketSummary {
  const { body: _body, stages, orchestration: _orchestration, ...rest } = t;
  return { ...rest, lifecycle: deriveLifecycle(stages ?? []) };
}

interface BoardStore {
  tickets: Map<string, TicketSummary>;
  /** Ordered list of ticket IDs open as tabs */
  openTicketIds: string[];
  /** Currently active ticket tab (null = board or session/file is active) */
  activeTicketId: string | null;
  /** Ticket being previewed in the right panel from the board (null = none).
   *  Distinct from `activeTicketId`: a preview keeps the board in the center. */
  previewTicketId: string | null;
  loading: boolean;
  error: string | null;

  fetchTickets: () => Promise<void>;
  createTicket: (
    title: string,
    body?: string,
    type?: TicketType,
  ) => Promise<Ticket>;
  updateTicket: (
    id: string,
    updates: {
      title?: string;
      body?: string;
      type?: TicketType;
    },
  ) => Promise<Ticket>;
  deleteTicket: (id: string) => Promise<void>;
  reorderTicket: (id: string, order: number) => Promise<void>;
  /** Open a ticket as a tab and activate it */
  openTicket: (id: string) => void;
  /** Close a ticket tab */
  closeTicket: (id: string) => void;
  /** Activate a ticket tab (must already be open) */
  activateTicket: (id: string) => void;
  /** Show the board view (deactivate any ticket) */
  showBoard: () => void;
  /** Preview a ticket in the right panel without leaving the board */
  setPreviewTicket: (id: string | null) => void;

  // Notification handlers
  handleDidChange: (ticket: TicketSummary) => void;
  handleDidCreate: (ticket: TicketSummary) => void;
  handleDidDelete: (id: string) => void;
  /** Check if a ticket references specs or sessions that no longer exist */
  getStaleTicketRefs: (ticketId: string, extraKnownSessionIds?: Set<string>) => { staleSpecIds: string[]; staleSessionIds: string[] } | null;
  /** Remove stale spec/session references from a ticket */
  fixStaleTicketRefs: (ticketId: string) => Promise<void>;
}

export const useBoardStore = create<BoardStore>()(persist((set, get) => ({
  tickets: new Map(),
  openTicketIds: [],
  activeTicketId: null,
  previewTicketId: null,
  loading: false,
  error: null,

  fetchTickets: async () => {
    set({ loading: true, error: null });
    try {
      const api = createBoardApi(getClient());
      const list = await api.list();
      const tickets = new Map<string, TicketSummary>();
      for (const t of list) {
        tickets.set(t.id, t);
      }
      // Drop persisted open-tab ids whose ticket no longer exists.
      const openTicketIds = get().openTicketIds.filter((id) => tickets.has(id));
      const activeTicketId =
        get().activeTicketId && tickets.has(get().activeTicketId as string)
          ? get().activeTicketId
          : null;
      set({ tickets, openTicketIds, activeTicketId, loading: false });
    } catch (e) {
      console.error("[boardStore] fetchTickets error:", e);
      set({ error: (e as Error).message, loading: false });
    }
  },

  createTicket: async (title, body, type) => {
    const api = createBoardApi(getClient());
    const ticket = await api.create(title, body, type);
    const tickets = new Map(get().tickets);
    tickets.set(ticket.id, toSummary(ticket));
    set({ tickets });
    return ticket;
  },

  updateTicket: async (id, updates) => {
    const api = createBoardApi(getClient());
    const ticket = await api.update(id, updates);
    const tickets = new Map(get().tickets);
    tickets.set(ticket.id, toSummary(ticket));
    set({ tickets });
    return ticket;
  },

  reorderTicket: async (id, order) => {
    const api = createBoardApi(getClient());
    const ticket = await api.reorder(id, order);
    const tickets = new Map(get().tickets);
    tickets.set(ticket.id, toSummary(ticket));
    set({ tickets });
  },

  deleteTicket: async (id) => {
    const api = createBoardApi(getClient());
    await api.delete(id);
    const tickets = new Map(get().tickets);
    tickets.delete(id);
    const openTicketIds = get().openTicketIds.filter((tid) => tid !== id);
    const activeTicketId = get().activeTicketId === id ? null : get().activeTicketId;
    set({ tickets, openTicketIds, activeTicketId });
    // The backend cascade-trashes this ticket's sessions; mirror that locally
    // (drop them from the Sessions panel) and refetch to reconcile.
    useSessionStore.getState().removeSessionsForTicket(id);
    void useSessionStore.getState().refreshSessionList().catch(() => { /* best-effort */ });
  },

  openTicket: (id) => {
    // A ticket opens as a tab in the Sessions view (ticket = folder, session
    // = file). Also clear any active file/session selection so the ticket tab
    // becomes the active tab.
    useUiStore.getState().setCenterView("sessions");
    useFileStore.setState({ activeFilePath: null, previewFilePath: null, previewFile: null });
    set((s) => {
      const openTicketIds = s.openTicketIds.includes(id)
        ? s.openTicketIds
        : [...s.openTicketIds, id];
      return { openTicketIds, activeTicketId: id, previewTicketId: null };
    });
  },

  closeTicket: (id) =>
    set((s) => {
      const openTicketIds = s.openTicketIds.filter((tid) => tid !== id);
      const activeTicketId = s.activeTicketId === id ? null : s.activeTicketId;
      return { openTicketIds, activeTicketId };
    }),

  activateTicket: (id) => set({ activeTicketId: id }),

  showBoard: () => set({ activeTicketId: null, previewTicketId: null }),

  setPreviewTicket: (id) => set({ previewTicketId: id }),

  // Notification handlers (called from wireEvents)
  handleDidChange: (ticket) =>
    set((s) => {
      const tickets = new Map(s.tickets);
      tickets.set(ticket.id, ticket);
      return { tickets };
    }),

  handleDidCreate: (ticket) =>
    set((s) => {
      const tickets = new Map(s.tickets);
      tickets.set(ticket.id, ticket);
      return { tickets };
    }),

  handleDidDelete: (id) => {
    set((s) => {
      const tickets = new Map(s.tickets);
      tickets.delete(id);
      const openTicketIds = s.openTicketIds.filter((tid) => tid !== id);
      const activeTicketId = s.activeTicketId === id ? null : s.activeTicketId;
      return { tickets, openTicketIds, activeTicketId };
    });
    useSessionStore.getState().removeSessionsForTicket(id);
  },

  getStaleTicketRefs: (ticketId, extraKnownSessionIds) => {
    const ticket = get().tickets.get(ticketId);
    if (!ticket) return null;

    const specs = useSpecStore.getState().specs;
    const staleSpecIds = findStaleSpecIds(ticket.linkedSpecIds, specs);

    const sessionState = useSessionStore.getState();
    const knownSids = new Set<string>();
    for (const [sid] of sessionState.sessions) knownSids.add(sid);
    for (const a of sessionState.archivedSessions) knownSids.add(a.thinkrailSid);
    // Sessions present on disk but not yet loaded into the in-memory maps
    // are still resumable — don't flag them as stale.
    if (extraKnownSessionIds) {
      for (const sid of extraKnownSessionIds) knownSids.add(sid);
    }
    const staleSessionIds = findStaleSessionIds(ticket.sessionIds, knownSids);

    if (staleSpecIds.length === 0 && staleSessionIds.length === 0) return null;
    return { staleSpecIds, staleSessionIds };
  },

  fixStaleTicketRefs: async (ticketId) => {
    const ticket = get().tickets.get(ticketId);
    if (!ticket) return;

    const stale = get().getStaleTicketRefs(ticketId);
    if (!stale) return;

    // Update locally first for immediate UI feedback
    const tickets = new Map(get().tickets);
    const updated = { ...ticket };
    if (stale.staleSpecIds.length > 0) {
      updated.linkedSpecIds = ticket.linkedSpecIds.filter((id) => !stale.staleSpecIds.includes(id));
    }
    if (stale.staleSessionIds.length > 0) {
      updated.sessionIds = ticket.sessionIds.filter((id) => !stale.staleSessionIds.includes(id));
    }
    tickets.set(ticketId, updated);
    set({ tickets });

    const api = createBoardApi(getClient());
    await Promise.allSettled([
      ...stale.staleSpecIds.map((id) => api.unlinkSpec(ticketId, id)),
      ...stale.staleSessionIds.map((id) => api.detachSession(ticketId, id)),
    ]);
  },
}), {
  name: `${STORAGE_PREFIX}board`,
  // Guarded storage: no-op if localStorage is unavailable (e.g. tests).
  storage: createJSONStorage(() => ({
    getItem: (name) => {
      try { return globalThis.localStorage?.getItem(name) ?? null; } catch { return null; }
    },
    setItem: (name, value) => {
      try { globalThis.localStorage?.setItem(name, value); } catch { /* ignore */ }
    },
    removeItem: (name) => {
      try { globalThis.localStorage?.removeItem(name); } catch { /* ignore */ }
    },
  })),
  // Only the open ticket tabs + active tab survive a reload. Ticket data
  // (the `tickets` Map) is refetched from the backend on load.
  partialize: (state) => ({
    openTicketIds: state.openTicketIds,
    activeTicketId: state.activeTicketId,
  }),
}));
