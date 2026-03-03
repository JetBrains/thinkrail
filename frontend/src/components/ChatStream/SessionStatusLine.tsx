import type { SessionMetrics } from "@/types/session.ts";

interface SessionStatusLineProps {
  model: string;
  metrics: SessionMetrics;
  running: boolean;
}

export function SessionStatusLine({
  model,
  metrics,
  running,
}: SessionStatusLineProps) {
  const contextPct =
    metrics.contextMax > 0
      ? Math.round((metrics.contextTokens / metrics.contextMax) * 100)
      : 0;
  const contextColor =
    contextPct > 80
      ? "var(--red)"
      : contextPct > 50
        ? "var(--gold)"
        : "var(--green)";

  return (
    <div className="session-status-line">
      <span className="ssl-model">{model}</span>
      <span className="ssl-sep" />
      <span className="ssl-cost">${metrics.costUsd.toFixed(2)}</span>
      <span className="ssl-sep" />
      <span className="ssl-tools">
        {running && <span className="ssl-pulse" />}
        {metrics.toolCalls} calls
      </span>
      {metrics.contextMax > 0 && (
        <>
          <span className="ssl-sep" />
          <span className="ssl-context">
            ctx {Math.round(metrics.contextTokens / 1000)}k/
            {Math.round(metrics.contextMax / 1000)}k
          </span>
          <span
            className="ssl-context-bar"
            style={
              {
                "--pct": `${contextPct}%`,
                "--bar-color": contextColor,
              } as React.CSSProperties
            }
          />
        </>
      )}
    </div>
  );
}
