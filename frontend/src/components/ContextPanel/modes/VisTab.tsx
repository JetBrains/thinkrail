import { useEffect } from "react";
import { useVisStore } from "@/store/visStore.ts";
import type { WorkflowStep, CoverageEntry, Recommendation, LintIssue } from "@/store/visStore.ts";

// ── Workflow Steps ────────────────────────────────────────────────────────────

const STEP_ICONS: Record<string, string> = {
  completed: "\u2713",
  in_progress: "\u25B6",
  pending: "\u25CB",
};
const STEP_COLORS: Record<string, string> = {
  completed: "var(--green)",
  in_progress: "var(--blue)",
  pending: "var(--hint)",
};

function WorkflowSection({ steps }: { steps: WorkflowStep[] }) {
  return (
    <div className="vis-tab-section">
      <div className="vis-tab-heading">Workflow</div>
      {steps.map((step) => (
        <div key={step.id} className="vis-tab-workflow-step">
          <span style={{ color: STEP_COLORS[step.status], fontSize: "var(--font-md)" }}>
            {STEP_ICONS[step.status]}
          </span>
          <span
            className="vis-tab-workflow-label"
            style={{
              fontWeight: step.status === "in_progress" ? 600 : 400,
              color: step.status === "pending" ? "var(--hint)" : "var(--text)",
            }}
          >
            {step.label}
          </span>
          {step.file && (
            <span className="vis-tab-workflow-file">{step.file}</span>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Coverage ──────────────────────────────────────────────────────────────────

const FRESHNESS_COLORS: Record<string, string> = {
  fresh: "var(--green)",
  stale: "var(--gold)",
  "n/a": "var(--hint)",
  uncovered: "var(--red)",
};

function CoverageSection({ coverage }: { coverage: CoverageEntry[] }) {
  const uncovered = coverage.filter((c) => !c.spec_id).length;
  const stale = coverage.filter((c) => c.freshness === "stale").length;

  return (
    <div className="vis-tab-section">
      <div className="vis-tab-heading">Coverage</div>
      {uncovered > 0 && (
        <div className="vis-tab-coverage-warn">
          {uncovered} uncovered director{uncovered === 1 ? "y" : "ies"}
        </div>
      )}
      {stale > 0 && (
        <div className="vis-tab-coverage-warn" style={{ color: "var(--gold)" }}>
          {stale} stale spec{stale === 1 ? "" : "s"}
        </div>
      )}
      <div className="vis-tab-coverage-list">
        {coverage.slice(0, 12).map((entry, i) => (
          <div key={i} className="vis-tab-coverage-entry">
            <span
              className="vis-tab-coverage-dot"
              style={{ color: FRESHNESS_COLORS[entry.freshness] }}
            >
              ●
            </span>
            <span className="vis-tab-coverage-path">{entry.path}</span>
          </div>
        ))}
        {coverage.length > 12 && (
          <div className="vis-tab-coverage-more">
            +{coverage.length - 12} more
          </div>
        )}
      </div>
    </div>
  );
}

// ── Recommendations ───────────────────────────────────────────────────────────

function RecommendationsSection({ recs }: { recs: Recommendation[] }) {
  if (recs.length === 0) return null;
  return (
    <div className="vis-tab-section">
      <div className="vis-tab-heading">Recommendations</div>
      {recs.map((rec, i) => (
        <div key={i} className="vis-tab-rec">
          <div className="vis-tab-rec-title">{rec.title}</div>
          <div className="vis-tab-rec-reason">{rec.reason}</div>
          <code className="vis-tab-rec-action">{rec.action}</code>
        </div>
      ))}
    </div>
  );
}

// ── Lint Issues ───────────────────────────────────────────────────────────────

function LintSection({ issues }: { issues: LintIssue[] }) {
  if (issues.length === 0) return null;
  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");
  const shown = [...errors, ...warnings].slice(0, 10);

  return (
    <div className="vis-tab-section">
      <div className="vis-tab-heading">
        Lint
        {errors.length > 0 && (
          <span className="vis-tab-lint-badge vis-tab-lint-error">
            {errors.length} error{errors.length !== 1 ? "s" : ""}
          </span>
        )}
        {warnings.length > 0 && (
          <span className="vis-tab-lint-badge vis-tab-lint-warn">
            {warnings.length} warning{warnings.length !== 1 ? "s" : ""}
          </span>
        )}
      </div>
      {shown.map((issue, i) => (
        <div key={i} className="vis-tab-lint-item">
          <span
            className="vis-tab-lint-icon"
            style={{ color: issue.severity === "error" ? "var(--red)" : "var(--gold)" }}
          >
            {issue.severity === "error" ? "\u2715" : "\u26A0"}
          </span>
          <span className="vis-tab-lint-msg">{issue.message}</span>
        </div>
      ))}
      {issues.length > 10 && (
        <div className="vis-tab-coverage-more">+{issues.length - 10} more</div>
      )}
    </div>
  );
}

// ── Main VisTab ───────────────────────────────────────────────────────────────

export function VisTab() {
  const dashboard = useVisStore((s) => s.dashboard);
  const loading = useVisStore((s) => s.loading);
  const fetchState = useVisStore((s) => s.fetchState);
  const recompute = useVisStore((s) => s.recompute);

  useEffect(() => {
    if (!dashboard) fetchState();
  }, [dashboard, fetchState]);

  if (loading && !dashboard) {
    return (
      <div className="vis-tab-loading">Computing dashboard...</div>
    );
  }

  if (!dashboard) {
    return (
      <div className="vis-tab-empty">
        <div>No dashboard data yet.</div>
        <button className="vis-tab-refresh-btn" onClick={recompute}>
          Compute now
        </button>
      </div>
    );
  }

  const pct = dashboard.coverage_pct;

  return (
    <div className="vis-tab">
      {/* Summary header */}
      <div className="vis-tab-summary">
        <div className="vis-tab-pct">{pct}%</div>
        <div className="vis-tab-pct-bar">
          <div className="vis-tab-pct-fill" style={{ width: `${pct}%` }} />
        </div>
        <div className="vis-tab-meta">
          {dashboard.tasks_done}/{dashboard.task_count} tasks
          {dashboard.stale_count > 0 && (
            <span style={{ color: "var(--gold)" }}>
              {" · "}{dashboard.stale_count} stale
            </span>
          )}
          {dashboard.lint_errors > 0 && (
            <span style={{ color: "var(--red)" }}>
              {" · "}{dashboard.lint_errors} lint error{dashboard.lint_errors !== 1 ? "s" : ""}
            </span>
          )}
        </div>
        <button
          className="vis-tab-refresh-btn"
          onClick={recompute}
          disabled={loading}
          title="Recompute dashboard"
        >
          {loading ? "..." : "\u21BB"}
        </button>
      </div>

      <WorkflowSection steps={dashboard.workflow_steps} />
      <RecommendationsSection recs={dashboard.recommendations} />
      <CoverageSection coverage={dashboard.coverage} />
      <LintSection issues={dashboard.lint_issues} />
    </div>
  );
}
