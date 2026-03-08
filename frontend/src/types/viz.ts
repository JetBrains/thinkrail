/** Visualization data types for the bonsai_visualize MCP tool. */

export type VizStatus =
  | "done"
  | "current"
  | "pending"
  | "error"
  | "skipped"
  | "stale"
  | "fresh"
  | "in_progress";

export type VizType =
  | "progress-tracker"
  | "summary-box"
  | "comparison"
  | "data-table"
  | "status-list"
  | "diagram";

/* ── progress-tracker ── */
export interface ProgressStep {
  label: string;
  status: VizStatus;
  file?: string;
  substeps?: { label: string; status: VizStatus }[];
}

export interface ProgressTrackerData {
  steps: ProgressStep[];
}

/* ── summary-box ── */
export interface SummarySection {
  heading: string;
  status?: VizStatus;
  items: { label: string; value: string }[];
}

export interface SummaryBoxData {
  sections: SummarySection[];
}

/* ── comparison ── */
export interface ComparisonOption {
  name: string;
  pros?: string[];
  cons?: string[];
  description?: string;
}

export interface ComparisonData {
  options: ComparisonOption[];
}

/* ── data-table ── */
export interface DataTableData {
  columns: string[];
  rows: string[][];
  statusColumn?: number;
}

/* ── status-list ── */
export interface StatusListItem {
  label: string;
  status: VizStatus;
  meta?: string;
}

export interface StatusListData {
  items: StatusListItem[];
}

/* ── diagram ── */
export interface DiagramNode {
  id: string;
  label: string;
  type?: string;
}

export interface DiagramEdge {
  from: string;
  to: string;
  label?: string;
}

export interface DiagramData {
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  layout?: "left-to-right" | "top-to-bottom";
}

/* ── Union type ── */
export type VizData =
  | { type: "progress-tracker"; title?: string; vizId?: string; data: ProgressTrackerData }
  | { type: "summary-box"; title?: string; vizId?: string; data: SummaryBoxData }
  | { type: "comparison"; title?: string; vizId?: string; data: ComparisonData }
  | { type: "data-table"; title?: string; vizId?: string; data: DataTableData }
  | { type: "status-list"; title?: string; vizId?: string; data: StatusListData }
  | { type: "diagram"; title?: string; vizId?: string; data: DiagramData };
