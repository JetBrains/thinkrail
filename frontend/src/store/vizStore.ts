import { create } from "zustand";
import { getClient } from "@/api/index.ts";

export interface WorkflowStep {
  id: string;
  label: string;
  status: "completed" | "in_progress" | "pending";
  file?: string;
}

export interface CoverageEntry {
  path: string;
  spec_id: string | null;
  spec_path: string | null;
  freshness: "fresh" | "stale" | "n/a" | "uncovered";
}

export interface TaskEntry {
  id: string;
  path: string;
  module: string;
  status: string;
}

export interface LintIssue {
  spec_id: string | null;
  path: string;
  severity: "error" | "warning";
  category: string;
  message: string;
  fixable: boolean;
}

export interface Recommendation {
  category: string;
  title: string;
  reason: string;
  action: string;
}

export interface DashboardState {
  coverage_pct: number;
  spec_count: number;
  active_count: number;
  stale_count: number;
  task_count: number;
  tasks_done: number;
  tasks_pending: number;
  lint_errors: number;
  lint_warnings: number;
  workflow_phase: string;
  workflow_steps: WorkflowStep[];
  coverage: CoverageEntry[];
  pending_tasks: TaskEntry[];
  lint_issues: LintIssue[];
  recommendations: Recommendation[];
  computed_at: string;
  one_liner: string;
}

interface VizStore {
  dashboard: DashboardState | null;
  loading: boolean;

  fetchState: () => Promise<void>;
  recompute: () => Promise<void>;
  onStateChanged: (state: DashboardState) => void;
}

export const useVizStore = create<VizStore>((set) => ({
  dashboard: null,
  loading: false,

  fetchState: async () => {
    set({ loading: true });
    try {
      const client = getClient();
      const result = await client.request("viz/state", {});
      set({ dashboard: result as DashboardState, loading: false });
    } catch (e) {
      console.error("[vizStore] fetchState error:", e);
      set({ loading: false });
    }
  },

  recompute: async () => {
    set({ loading: true });
    try {
      const client = getClient();
      const result = await client.request("viz/recompute", {});
      set({ dashboard: result as DashboardState, loading: false });
    } catch (e) {
      console.error("[vizStore] recompute error:", e);
      set({ loading: false });
    }
  },

  onStateChanged: (state: DashboardState) => {
    set({ dashboard: state });
  },
}));
