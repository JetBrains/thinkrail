import type { CostSummary, CostBudget } from "../types.ts";

/**
 * Stub — cost/* backend endpoints don't exist yet.
 * Returns null summary. Will be wired when backend cost API is implemented.
 */
export function useCost() {
  return {
    summary: null as CostSummary | null,
    loading: false,
    refetch: async () => {},
    setBudget: async (_budget: CostBudget) => {},
    reset: async () => {},
  };
}
