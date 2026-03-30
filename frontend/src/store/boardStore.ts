import { create } from "zustand";
import type {
  MetaTicket,
  MetaTicketSummary,
  MetaTicketStatus,
  MetaTicketType,
} from "@/types/board.ts";
import { getClient } from "@/api/index.ts";
import { createBoardApi } from "@/api/methods/board.ts";

interface BoardStore {
  tickets: Map<string, MetaTicketSummary>;
  /** Ordered list of ticket IDs open as tabs */
  openTicketIds: string[];
  /** Currently active ticket tab (null = board or session/file is active) */
  activeTicketId: string | null;
  loading: boolean;
  error: string | null;

  fetchTickets: () => Promise<void>;
  createTicket: (
    title: string,
    body?: string,
    type?: MetaTicketType,
  ) => Promise<MetaTicket>;
  updateTicket: (
    id: string,
    updates: {
      title?: string;
      body?: string;
      status?: MetaTicketStatus;
      type?: MetaTicketType;
    },
  ) => Promise<MetaTicket>;
  deleteTicket: (id: string) => Promise<void>;
  reorderTicket: (id: string, status: MetaTicketStatus, order: number) => Promise<void>;
  /** Open a ticket as a tab and activate it */
  openTicket: (id: string) => void;
  /** Close a ticket tab */
  closeTicket: (id: string) => void;
  /** Activate a ticket tab (must already be open) */
  activateTicket: (id: string) => void;
  /** Show the board view (deactivate any ticket) */
  showBoard: () => void;

  // Notification handlers
  handleDidChange: (ticket: MetaTicketSummary) => void;
  handleDidCreate: (ticket: MetaTicketSummary) => void;
  handleDidDelete: (id: string) => void;
}

export const useBoardStore = create<BoardStore>((set, get) => ({
  tickets: new Map(),
  openTicketIds: [],
  activeTicketId: null,
  loading: false,
  error: null,

  fetchTickets: async () => {
    set({ loading: true, error: null });
    try {
      const api = createBoardApi(getClient());
      const list = await api.list();
      const tickets = new Map<string, MetaTicketSummary>();
      for (const t of list) {
        tickets.set(t.id, t);
      }
      set({ tickets, loading: false });
    } catch (e) {
      console.error("[boardStore] fetchTickets error:", e);
      set({ error: (e as Error).message, loading: false });
    }
  },

  createTicket: async (title, body, type) => {
    const api = createBoardApi(getClient());
    const ticket = await api.create(title, body, type);
    const tickets = new Map(get().tickets);
    tickets.set(ticket.id, ticket);
    set({ tickets });
    return ticket;
  },

  updateTicket: async (id, updates) => {
    const api = createBoardApi(getClient());
    const ticket = await api.update(id, updates);
    const tickets = new Map(get().tickets);
    tickets.set(ticket.id, ticket);
    set({ tickets });
    return ticket;
  },

  reorderTicket: async (id, status, order) => {
    const api = createBoardApi(getClient());
    const ticket = await api.reorder(id, status, order);
    const tickets = new Map(get().tickets);
    tickets.set(ticket.id, ticket);
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
  },

  openTicket: (id) =>
    set((s) => {
      const openTicketIds = s.openTicketIds.includes(id)
        ? s.openTicketIds
        : [...s.openTicketIds, id];
      return { openTicketIds, activeTicketId: id };
    }),

  closeTicket: (id) =>
    set((s) => {
      const openTicketIds = s.openTicketIds.filter((tid) => tid !== id);
      const activeTicketId = s.activeTicketId === id ? null : s.activeTicketId;
      return { openTicketIds, activeTicketId };
    }),

  activateTicket: (id) => set({ activeTicketId: id }),

  showBoard: () => set({ activeTicketId: null }),

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

  handleDidDelete: (id) =>
    set((s) => {
      const tickets = new Map(s.tickets);
      tickets.delete(id);
      const openTicketIds = s.openTicketIds.filter((tid) => tid !== id);
      const activeTicketId = s.activeTicketId === id ? null : s.activeTicketId;
      return { tickets, openTicketIds, activeTicketId };
    }),
}));
