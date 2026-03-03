import { useSpecStore } from "@/store/specStore.ts";
import { useSessionStore } from "@/store/sessionStore.ts";
import { useCostStore } from "@/store/costStore.ts";
import { ActivityTimeline } from "./ActivityTimeline.tsx";
import { SessionHistory } from "@/components/SessionHistory/SessionHistory.tsx";
import type { AgentEvent } from "@/types/agent.ts";
import "./ProgressTab.css";

export function ProgressTab() {
  const specs = useSpecStore((s) => s.specs);
  const sessions = useSessionStore((s) => s.sessions);
  const costSummary = useCostStore((s) => s.summary);

  const total = specs.length;
  const done = specs.filter((s) => s.status === "done").length;
  const active = specs.filter((s) => s.status === "active").length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  const sessionList = Array.from(sessions.values());
  const allEvents: AgentEvent[] = sessionList.flatMap((s) => s.events);

  return (
    <div className="progress-tab">
      {/* Spec Progress */}
      <div className="progress-section">
        <div className="progress-section-header">Spec Progress</div>
        <div className="progress-bar-row">
          <div className="progress-bar">
            <div className="progress-bar-fill" style={{ width: `${pct}%` }} />
          </div>
          <span className="progress-pct">{pct}%</span>
        </div>
        <div className="progress-stats">
          <span className="stat-done">{"\u2713"} {done} done</span>
          <span className="stat-active">{"\u25CF"} {active} active</span>
          <span className="stat-pending">{"\u25CB"} {total - done - active} pending</span>
        </div>
      </div>

      {/* Active Sessions */}
      {sessionList.length > 0 && (
        <div className="progress-section">
          <div className="progress-section-header">Active Sessions</div>
          {sessionList.map((s) => (
            <div key={`progress-${s.taskId}`} className="session-card">
              <div className="session-card-header">
                <span
                  className="session-card-dot"
                  style={{
                    background:
                      s.status === "running"
                        ? "var(--blue)"
                        : s.status === "done"
                          ? "var(--green)"
                          : "var(--red)",
                  }}
                />
                <span className="session-card-name">{s.name}</span>
                <span className="session-card-status">{s.status}</span>
              </div>
              <div className="session-card-metrics">
                {s.metrics.toolCalls} calls
                {" \u00B7 "}${s.metrics.costUsd.toFixed(2)}
                {" \u00B7 "}{Math.round(s.metrics.durationMs / 1000)}s
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Cost */}
      {costSummary && (
        <div className="progress-section">
          <div className="progress-section-header">Cost</div>
          <div className="cost-display">
            ${costSummary.sessionCost.toFixed(2)} session
            {" \u00B7 "}${costSummary.projectCost.toFixed(2)} total
          </div>
        </div>
      )}

      {/* Activity Timeline */}
      <div className="progress-section">
        <div className="progress-section-header">Activity</div>
        <ActivityTimeline events={allEvents} />
      </div>

      {/* Session History */}
      <div className="progress-section">
        <div className="progress-section-header">History</div>
        <SessionHistory />
      </div>
    </div>
  );
}
