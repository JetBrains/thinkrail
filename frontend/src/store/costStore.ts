import { create } from "zustand";
import type { CostSummary } from "@/api/types.ts";

interface CostStore {
  summary: CostSummary | null;
  loading: boolean;
}

/**
 * Stub — backend cost/* endpoints don't exist yet.
 * Will be wired when backend cost API is implemented.
 */
export const useCostStore = create<CostStore>(() => ({
  summary: null,
  loading: false,
}));
