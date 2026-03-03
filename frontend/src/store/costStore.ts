import { create } from "zustand";
import type { CostSummary, CostBudget } from "@/api/types.ts";

interface CostStore {
  summary: CostSummary | null;
  loading: boolean;

  fetchSummary: () => Promise<void>;
  setBudget: (budget: CostBudget) => Promise<void>;
  reset: () => Promise<void>;
  startPolling: () => void;
  stopPolling: () => void;
}

let pollTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Stub — backend cost/* endpoints don't exist yet.
 * Actions are no-ops. Will be wired when backend cost API is implemented.
 */
export const useCostStore = create<CostStore>((_set, get) => ({
  summary: null,
  loading: false,

  fetchSummary: async () => {
    // TODO: implement when backend cost/summary exists
  },

  setBudget: async (_budget: CostBudget) => {
    // TODO: implement when backend cost/setBudget exists
  },

  reset: async () => {
    // TODO: implement when backend cost/reset exists
  },

  startPolling: () => {
    if (pollTimer) return;
    pollTimer = setInterval(() => get().fetchSummary(), 5000);
  },

  stopPolling: () => {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  },
}));
