/** Visualization data types for the bonsai_visualize MCP tool. */

export type VisStatus =
  | "done"
  | "current"
  | "pending"
  | "error"
  | "skipped"
  | "stale"
  | "fresh"
  | "in_progress";

export type VisType =
  | "progress-tracker"
  | "summary-box"
  | "comparison"
  | "data-table"
  | "status-list"
  | "diagram";

/* ── progress-tracker ── */
export interface ProgressStep {
  label: string;
  status: VisStatus;
  file?: string;
  substeps?: { label: string; status: VisStatus }[];
}

export interface ProgressTrackerData {
  steps: ProgressStep[];
}

/* ── summary-box ── */
export interface SummarySection {
  heading: string;
  status?: VisStatus;
  items: { label: string; value: string; url?: string }[];
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
  visualization?: string; // Mermaid syntax string
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
  status: VisStatus;
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

/** Structured node/edge diagram */
export interface StructuredDiagramData {
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  layout?: "left-to-right" | "top-to-bottom";
}

/** Text-based diagram (ASCII art, flowchart notation, etc.) */
export interface TextDiagramData {
  diagram: string;
  notation?: string;
}

export type DiagramData = StructuredDiagramData | TextDiagramData;

/* ── Layout hints ── */
export interface VisLayout {
  width?: "compact" | "normal" | "wide";
  maxHeight?: number;
}

/* ── Union type ── */
export type VisData =
  | { type: "progress-tracker"; title?: string; visId?: string; layout?: VisLayout; data: ProgressTrackerData }
  | { type: "summary-box"; title?: string; visId?: string; layout?: VisLayout; data: SummaryBoxData }
  | { type: "comparison"; title?: string; visId?: string; layout?: VisLayout; data: ComparisonData }
  | { type: "data-table"; title?: string; visId?: string; layout?: VisLayout; data: DataTableData }
  | { type: "status-list"; title?: string; visId?: string; layout?: VisLayout; data: StatusListData }
  | { type: "diagram"; title?: string; visId?: string; layout?: VisLayout; data: DiagramData };
