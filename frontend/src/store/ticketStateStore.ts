import { create } from "zustand";
import type { TicketState } from "@/types/rpc-methods.ts";
import { getClient } from "@/api/index.ts";
import { createBoardApi } from "@/api/methods/board.ts";

interface TicketStateStore {
  states: Map<string, TicketState>;
  /** Apply an incoming snapshot, ignoring stale (older-or-equal rev) ones. */
  apply: (state: TicketState) => void;
  /** Fetch the current snapshot for a ticket and seed the store. */
  fetch: (id: string) => Promise<TicketState>;
}

export const useTicketStateStore = create<TicketStateStore>((set, getState) => ({
  states: new Map(),

  apply: (state) =>
    set((s) => {
      const existing = s.states.get(state.id);
      if (existing && (existing.rev ?? 0) >= (state.rev ?? 0)) return s;
      const states = new Map(s.states);
      states.set(state.id, state);
      return { states };
    }),

  fetch: async (id) => {
    const snapshot = await createBoardApi(getClient()).getState(id);
    getState().apply(snapshot);
    return snapshot;
  },
}));
