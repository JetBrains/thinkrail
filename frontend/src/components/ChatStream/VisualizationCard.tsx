import { Component, useCallback, useState } from "react";
import { VisStatus } from "@/constants/status.ts";
import { useExpandCollapse } from "./useExpandCollapse.ts";
import { MermaidDiagram } from "@/components/ui/MermaidDiagram.tsx";
import type { ErrorInfo, ReactNode } from "react";
import type {
  VisData,
  ProgressTrackerData,
  SummaryBoxData,
  ComparisonData,
  DataTableData,
  StatusListData,
  DiagramData,
  StructuredDiagramData,
} from "@/types/vis.ts";

/* ── Status rendering ── */

const STATUS_ICONS: Record<VisStatus, string> = {
  [VisStatus.Done]: "\u2713",
  [VisStatus.Current]: "\u25B6",
  [VisStatus.Pending]: "\u25CB",
  [VisStatus.Error]: "\u2715",
  [VisStatus.Skipped]: "\u2298",
  [VisStatus.Stale]: "~",
  [VisStatus.Fresh]: "\u2713",
  [VisStatus.InProgress]: "\u25D0",
};

const STATUS_COLORS: Record<VisStatus, string> = {
  [VisStatus.Done]: "var(--green)",
  [VisStatus.Current]: "var(--blue)",
  [VisStatus.Pending]: "var(--hint)",
  [VisStatus.Error]: "var(--red)",
  [VisStatus.Skipped]: "var(--hint)",
  [VisStatus.Stale]: "var(--gold)",
  [VisStatus.Fresh]: "var(--green)",
  [VisStatus.InProgress]: "var(--blue)",
};

function StatusIcon({ status }: { status: VisStatus }) {
  return (
    <span
      className="vis-status-icon"
      style={{ color: STATUS_COLORS[status] }}
    >
      {STATUS_ICONS[status]}
    </span>
  );
}

/* ── Progress Tracker ── */

function ProgressTracker({ data }: { data: ProgressTrackerData }) {
  return (
    <div className="vis-progress">
      {(data.steps ?? []).map((step, i) => (
        <div key={i} className="vis-progress-step">
          <div className="vis-progress-step-row">
            <StatusIcon status={step.status} />
            <span
              className="vis-progress-label"
              style={{
                fontWeight: step.status === VisStatus.Current ? 600 : 400,
                color: step.status === VisStatus.Pending ? "var(--hint)" : "var(--text)",
              }}
            >
              {step.label}
            </span>
            {step.file && (
              <span className="vis-progress-file">{step.file}</span>
            )}
          </div>
          {step.substeps && (
            <div className="vis-progress-substeps">
              {step.substeps.map((sub, j) => (
                <div key={j} className="vis-progress-substep">
                  <StatusIcon status={sub.status} />
                  <span style={{ color: sub.status === VisStatus.Pending ? "var(--hint)" : "var(--muted)" }}>
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
    <div className="vis-summary">
      {(data.sections ?? []).map((section, i) => (
        <div key={i} className="vis-summary-section">
          <div className="vis-summary-heading">
            {section.status && <StatusIcon status={section.status} />}
            <span>{section.heading}</span>
          </div>
          {(section.items ?? []).length > 0 ? (
            <div className="vis-summary-items">
              {(section.items ?? []).map((item, j) => (
                <div key={j} className="vis-summary-item">
                  {item.url ? (
                    <a className="vis-summary-item-label vis-summary-item-link" href={item.url} target="_blank" rel="noopener noreferrer">{item.label}</a>
                  ) : (
                    <span className="vis-summary-item-label">{item.label}</span>
                  )}
                  <span className="vis-summary-item-value">{item.value}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="vis-summary-empty">No items yet</div>
          )}
        </div>
      ))}
    </div>
  );
}

/* ── Comparison ── */

function Comparison({ data }: { data: ComparisonData }) {
  return (
    <div className="vis-comparison">
      {(data.options ?? []).map((opt, i) => (
        <div key={i} className="vis-comparison-card">
          <div className="vis-comparison-name">{opt.name}</div>
          {opt.description && (
            <div className="vis-comparison-desc">{opt.description}</div>
          )}
          {opt.visualization && (
            <div className="vis-comparison-diagram">
              <MermaidDiagram syntax={opt.visualization} />
            </div>
          )}
          {opt.pros && opt.pros.length > 0 && (
            <div className="vis-comparison-list">
              {opt.pros.map((p, j) => (
                <div key={j} className="vis-comparison-pro">
                  <span style={{ color: "var(--green)" }}>{"\u2713"}</span> {p}
                </div>
              ))}
            </div>
          )}
          {opt.cons && opt.cons.length > 0 && (
            <div className="vis-comparison-list">
              {opt.cons.map((c, j) => (
                <div key={j} className="vis-comparison-con">
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
    <div className="vis-table-wrap">
      <table className="vis-table">
        <thead>
          <tr>
            {(data.columns ?? []).map((col, i) => (
              <th key={i}>{col}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {(data.rows ?? []).map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => (
                <td
                  key={j}
                  style={
                    data.statusColumn === j
                      ? { color: cell === VisStatus.Fresh || cell === VisStatus.Done ? "var(--green)" : cell === VisStatus.Stale ? "var(--gold)" : "var(--muted)" }
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
    <div className="vis-status-list">
      {(data.items ?? []).map((item, i) => (
        <div key={i} className="vis-status-list-item">
          <StatusIcon status={item.status} />
          <span className="vis-status-list-label">{item.label}</span>
          {item.meta && (
            <span className="vis-status-list-meta">{item.meta}</span>
          )}
        </div>
      ))}
    </div>
  );
}

/* ── Diagram (Mermaid-based) ── */

/** Convert structured {nodes, edges, layout?} to mermaid flowchart syntax. */
export function toMermaidSyntax(data: StructuredDiagramData): string {
  const direction = data.layout === "left-to-right" ? "LR" : "TD";
  const lines: string[] = [`graph ${direction}`];

  for (const node of data.nodes) {
    // Wrap label in quotes to escape special mermaid chars
    const escaped = node.label.replace(/"/g, "#quot;");
    lines.push(`  ${node.id}["${escaped}"]`);
  }
  for (const edge of data.edges) {
    if (edge.label) {
      const escaped = edge.label.replace(/"/g, "#quot;");
      lines.push(`  ${edge.from} -->|"${escaped}"| ${edge.to}`);
    } else {
      lines.push(`  ${edge.from} --> ${edge.to}`);
    }
  }
  return lines.join("\n");
}

function Diagram({ data }: { data: DiagramData }) {
  // Text-based diagram: check for mermaid notation
  if ("diagram" in data && typeof data.diagram === "string") {
    if ("notation" in data && data.notation === "mermaid") {
      return (
        <div className="vis-diagram">
          <MermaidDiagram syntax={data.diagram} />
        </div>
      );
    }
    return (
      <div className="vis-diagram">
        <pre className="vis-diagram-text">{data.diagram}</pre>
      </div>
    );
  }

  // Structured diagram: render with Mermaid
  if ("nodes" in data && Array.isArray(data.nodes) && data.nodes.length > 0) {
    const syntax = toMermaidSyntax(data);
    return <MermaidDiagram syntax={syntax} />;
  }

  // Neither format: show informative empty state
  return (
    <div className="vis-diagram">
      <div style={{ color: "var(--hint)", fontSize: "var(--font-md)" }}>
        No diagram data
      </div>
    </div>
  );
}

/* ── Type icons ── */

const VIS_ICONS: Record<string, string> = {
  "progress-tracker": "\u{1F4CA}",
  "summary-box": "\u{1F4CB}",
  "comparison": "\u2194\uFE0F",
  "data-table": "\u{1F5C2}\uFE0F",
  "status-list": "\u{1F4DD}",
  "diagram": "\u{1F5FA}\uFE0F",
};

/* ── Error Boundary ── */

export class VisErrorBoundary extends Component<
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
        <div className="vis-card" style={{ borderColor: "var(--red)" }}>
          <div className="vis-card-header">
            <span className="vis-card-icon">{"\u26A0"}</span>
            <span className="vis-card-title">Visualization Error</span>
          </div>
          <div className="vis-card-body" style={{ fontSize: "var(--font-md)", color: "var(--red)" }}>
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
  data: VisData;
  collapsed?: boolean;
  /** When true, the header is always clickable to toggle collapse (used in compact mode). */
  compactMode?: boolean;
}

export function VisualizationCard({ data, collapsed = false, compactMode = false }: VisualizationCardProps) {
  const [isCollapsed, setIsCollapsed] = useState(collapsed);
  const expandRef = useExpandCollapse(
    useCallback((v: boolean) => setIsCollapsed(!v), []),
    true, // isVisualization — ignores collapseEvents, only responds to expandAll/collapseAll
  );
  const icon = VIS_ICONS[data?.type] ?? "\u{1F4CA}";

  if (!data?.type || !data?.data) {
    return (
      <div className="vis-card" style={{ borderColor: "var(--red)" }}>
        <div className="vis-card-header">
          <span className="vis-card-icon">{"\u26A0"}</span>
          <span className="vis-card-title">Visualization Error</span>
        </div>
        <div className="vis-card-body" style={{ fontSize: "var(--font-md)", color: "var(--red)" }}>
          Invalid data: type={data?.type ?? "missing"}, data={typeof data?.data}
        </div>
      </div>
    );
  }

  const layout = data.layout;
  const widthClass = layout?.width === "compact"
    ? "vis-card--compact"
    : layout?.width === "wide"
      ? "vis-card--wide"
      : "";

  if (isCollapsed) {
    return (
      <div
        ref={expandRef}
        className={`vis-card vis-card--collapsed ${widthClass}`}
        onClick={() => setIsCollapsed(false)}
      >
        <span className="vis-card-icon">{icon}</span>
        <span className="vis-card-title">{data.title ?? data.type}</span>
        <span className="vis-card-tag">updated</span>
        <span className="vis-card-expand">{"\u25B6"}</span>
      </div>
    );
  }

  return (
    <div ref={expandRef} className={`vis-card ${widthClass}`}>
      <div
        className="vis-card-header"
        onClick={() => (collapsed || compactMode) && setIsCollapsed(true)}
        style={{ cursor: (collapsed || compactMode) ? "pointer" : undefined }}
      >
        <span className="vis-card-icon">{icon}</span>
        <span className="vis-card-title">{data.title ?? data.type}</span>
        <span className="vis-card-type">{data.type}</span>
        {compactMode && <span className="vis-card-collapse-hint">{"\u25BC"}</span>}
      </div>
      <div
        className="vis-card-body"
        style={{
          maxHeight: layout?.maxHeight ? `${layout.maxHeight}px` : undefined,
          overflowY: layout?.maxHeight ? "auto" : undefined,
        }}
      >
        {typeof data.data !== "object" || data.data === null || (data.data as unknown as { _parseError?: boolean })._parseError ? (
          <div style={{ color: "var(--hint)", fontSize: "var(--font-lg)", padding: "var(--space-sm)" }}>
            Visualization data could not be parsed — the model sent malformed input.
          </div>
        ) : (
          <>
            {data.type === "progress-tracker" && <ProgressTracker data={data.data} />}
            {data.type === "summary-box" && <SummaryBox data={data.data} />}
            {data.type === "comparison" && <Comparison data={data.data} />}
            {data.type === "data-table" && <DataTable data={data.data} />}
            {data.type === "status-list" && <StatusList data={data.data} />}
            {data.type === "diagram" && <Diagram data={data.data} />}
          </>
        )}
      </div>
    </div>
  );
}

/* ── Collapsed Marker (for hybrid collapse pattern) ── */

export function CollapsedVisMarker({ title, type }: { title?: string; type?: string }) {
  const [expanded, setExpanded] = useState(false);
  const icon = VIS_ICONS[type ?? ""] ?? "\u{1F4CA}";

  if (expanded) {
    return null; // Handled by parent re-rendering full card
  }

  return (
    <div className="vis-collapsed-marker" onClick={() => setExpanded(true)}>
      <span>{icon}</span>
      <span className="vis-collapsed-marker-title">{title ?? type ?? "Visualization"}</span>
      <span className="vis-collapsed-marker-tag">updated</span>
    </div>
  );
}
