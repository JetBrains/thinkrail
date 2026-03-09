import { Component, useState } from "react";
import type { ErrorInfo, ReactNode } from "react";
import type {
  VizData,
  VizStatus,
  ProgressTrackerData,
  SummaryBoxData,
  ComparisonData,
  DataTableData,
  StatusListData,
  DiagramData,
} from "@/types/viz.ts";

/* ── Status rendering ── */

const STATUS_ICONS: Record<VizStatus, string> = {
  done: "\u2713",
  current: "\u25B6",
  pending: "\u25CB",
  error: "\u2715",
  skipped: "\u2298",
  stale: "~",
  fresh: "\u2713",
  in_progress: "\u25D0",
};

const STATUS_COLORS: Record<VizStatus, string> = {
  done: "var(--green)",
  current: "var(--blue)",
  pending: "var(--hint)",
  error: "var(--red)",
  skipped: "var(--hint)",
  stale: "var(--gold)",
  fresh: "var(--green)",
  in_progress: "var(--blue)",
};

function StatusIcon({ status }: { status: VizStatus }) {
  return (
    <span
      className="viz-status-icon"
      style={{ color: STATUS_COLORS[status] }}
    >
      {STATUS_ICONS[status]}
    </span>
  );
}

/* ── Progress Tracker ── */

function ProgressTracker({ data }: { data: ProgressTrackerData }) {
  return (
    <div className="viz-progress">
      {data.steps.map((step, i) => (
        <div key={i} className="viz-progress-step">
          <div className="viz-progress-step-row">
            <StatusIcon status={step.status} />
            <span
              className="viz-progress-label"
              style={{
                fontWeight: step.status === "current" ? 600 : 400,
                color: step.status === "pending" ? "var(--hint)" : "var(--text)",
              }}
            >
              {step.label}
            </span>
            {step.file && (
              <span className="viz-progress-file">{step.file}</span>
            )}
          </div>
          {step.substeps && (
            <div className="viz-progress-substeps">
              {step.substeps.map((sub, j) => (
                <div key={j} className="viz-progress-substep">
                  <StatusIcon status={sub.status} />
                  <span style={{ color: sub.status === "pending" ? "var(--hint)" : "var(--muted)" }}>
                    {sub.label}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/* ── Summary Box ── */

function SummaryBox({ data }: { data: SummaryBoxData }) {
  return (
    <div className="viz-summary">
      {data.sections.map((section, i) => (
        <div key={i} className="viz-summary-section">
          <div className="viz-summary-heading">
            {section.status && <StatusIcon status={section.status} />}
            <span>{section.heading}</span>
          </div>
          {section.items.length > 0 ? (
            <div className="viz-summary-items">
              {section.items.map((item, j) => (
                <div key={j} className="viz-summary-item">
                  <span className="viz-summary-item-label">{item.label}</span>
                  <span className="viz-summary-item-value">{item.value}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="viz-summary-empty">No items yet</div>
          )}
        </div>
      ))}
    </div>
  );
}

/* ── Comparison ── */

function Comparison({ data }: { data: ComparisonData }) {
  return (
    <div className="viz-comparison">
      {data.options.map((opt, i) => (
        <div key={i} className="viz-comparison-card">
          <div className="viz-comparison-name">{opt.name}</div>
          {opt.description && (
            <div className="viz-comparison-desc">{opt.description}</div>
          )}
          {opt.pros && opt.pros.length > 0 && (
            <div className="viz-comparison-list">
              {opt.pros.map((p, j) => (
                <div key={j} className="viz-comparison-pro">
                  <span style={{ color: "var(--green)" }}>{"\u2713"}</span> {p}
                </div>
              ))}
            </div>
          )}
          {opt.cons && opt.cons.length > 0 && (
            <div className="viz-comparison-list">
              {opt.cons.map((c, j) => (
                <div key={j} className="viz-comparison-con">
                  <span style={{ color: "var(--red)" }}>{"\u2715"}</span> {c}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/* ── Data Table ── */

function DataTable({ data }: { data: DataTableData }) {
  return (
    <div className="viz-table-wrap">
      <table className="viz-table">
        <thead>
          <tr>
            {data.columns.map((col, i) => (
              <th key={i}>{col}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.rows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => (
                <td
                  key={j}
                  style={
                    data.statusColumn === j
                      ? { color: cell === "fresh" || cell === "done" ? "var(--green)" : cell === "stale" ? "var(--gold)" : "var(--muted)" }
                      : undefined
                  }
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── Status List ── */

function StatusList({ data }: { data: StatusListData }) {
  return (
    <div className="viz-status-list">
      {data.items.map((item, i) => (
        <div key={i} className="viz-status-list-item">
          <StatusIcon status={item.status} />
          <span className="viz-status-list-label">{item.label}</span>
          {item.meta && (
            <span className="viz-status-list-meta">{item.meta}</span>
          )}
        </div>
      ))}
    </div>
  );
}

/* ── Diagram (simple box-and-arrow) ── */

function Diagram({ data }: { data: DiagramData }) {
  // Simple text-based rendering for now; can be upgraded to SVG later
  return (
    <div className="viz-diagram">
      <div className="viz-diagram-nodes">
        {data.nodes.map((node) => (
          <div key={node.id} className="viz-diagram-node">
            <span className="viz-diagram-node-label">{node.label}</span>
            {node.type && (
              <span className="viz-diagram-node-type">{node.type}</span>
            )}
          </div>
        ))}
      </div>
      {data.edges.length > 0 && (
        <div className="viz-diagram-edges">
          {data.edges.map((edge, i) => (
            <div key={i} className="viz-diagram-edge">
              {edge.from} {"\u2192"} {edge.to}
              {edge.label && <span className="viz-diagram-edge-label"> ({edge.label})</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Type icons ── */

const VIZ_ICONS: Record<string, string> = {
  "progress-tracker": "\u{1F4CA}",
  "summary-box": "\u{1F4CB}",
  "comparison": "\u2194\uFE0F",
  "data-table": "\u{1F5C2}\uFE0F",
  "status-list": "\u{1F4DD}",
  "diagram": "\u{1F5FA}\uFE0F",
};

/* ── Error Boundary ── */

export class VizErrorBoundary extends Component<
  { children: ReactNode },
  { error: string | null }
> {
  state = { error: null as string | null };

  static getDerivedStateFromError(error: Error) {
    return { error: error.message };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[VisualizationCard] render error:", error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="viz-card" style={{ borderColor: "var(--red)" }}>
          <div className="viz-card-header">
            <span className="viz-card-icon">{"\u26A0"}</span>
            <span className="viz-card-title">Visualization Error</span>
          </div>
          <div className="viz-card-body" style={{ fontSize: 11, color: "var(--red)" }}>
            {this.state.error}
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

/* ── Main Component ── */

interface VisualizationCardProps {
  data: VizData;
  collapsed?: boolean;
}

export function VisualizationCard({ data, collapsed = false }: VisualizationCardProps) {
  const [isCollapsed, setIsCollapsed] = useState(collapsed);
  const icon = VIZ_ICONS[data?.type] ?? "\u{1F4CA}";

  if (!data?.type || !data?.data) {
    return (
      <div className="viz-card" style={{ borderColor: "var(--red)" }}>
        <div className="viz-card-header">
          <span className="viz-card-icon">{"\u26A0"}</span>
          <span className="viz-card-title">Visualization Error</span>
        </div>
        <div className="viz-card-body" style={{ fontSize: 11, color: "var(--red)" }}>
          Invalid data: type={data?.type ?? "missing"}, data={typeof data?.data}
        </div>
      </div>
    );
  }

  if (isCollapsed) {
    return (
      <div
        className="viz-card viz-card--collapsed"
        onClick={() => setIsCollapsed(false)}
      >
        <span className="viz-card-icon">{icon}</span>
        <span className="viz-card-title">{data.title ?? data.type}</span>
        <span className="viz-card-tag">updated</span>
        <span className="viz-card-expand">{"\u25B6"}</span>
      </div>
    );
  }

  return (
    <div className="viz-card">
      <div className="viz-card-header" onClick={() => collapsed && setIsCollapsed(true)}>
        <span className="viz-card-icon">{icon}</span>
        <span className="viz-card-title">{data.title ?? data.type}</span>
        <span className="viz-card-type">{data.type}</span>
      </div>
      <div className="viz-card-body">
        {data.type === "progress-tracker" && <ProgressTracker data={data.data} />}
        {data.type === "summary-box" && <SummaryBox data={data.data} />}
        {data.type === "comparison" && <Comparison data={data.data} />}
        {data.type === "data-table" && <DataTable data={data.data} />}
        {data.type === "status-list" && <StatusList data={data.data} />}
        {data.type === "diagram" && <Diagram data={data.data} />}
      </div>
    </div>
  );
}

/* ── Collapsed Marker (for hybrid collapse pattern) ── */

export function CollapsedVizMarker({ title, type }: { title?: string; type?: string }) {
  const [expanded, setExpanded] = useState(false);
  const icon = VIZ_ICONS[type ?? ""] ?? "\u{1F4CA}";

  if (expanded) {
    return null; // Handled by parent re-rendering full card
  }

  return (
    <div className="viz-collapsed-marker" onClick={() => setExpanded(true)}>
      <span>{icon}</span>
      <span className="viz-collapsed-marker-title">{title ?? type ?? "Visualization"}</span>
      <span className="viz-collapsed-marker-tag">updated</span>
    </div>
  );
}
