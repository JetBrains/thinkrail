import type { AgentEvent } from "@/types/agent.ts";

interface ActivityTimelineProps {
  events: AgentEvent[];
}

const EVENT_ICONS: Record<string, string> = {
  toolCallStart: "\u{1F527}",
  toolCallEnd: "\u2713",
  textDelta: "\u{1F4AC}",
  sessionStart: "\u{1F680}",
  subagentStart: "\u26A1",
  done: "\u2713",
  error: "\u2715",
};

export function ActivityTimeline({ events }: ActivityTimelineProps) {
  if (!Array.isArray(events)) return <div className="progress-empty">No activity yet</div>;
  const recent = events.slice(-20).reverse();

  if (recent.length === 0) {
    return <div className="progress-empty">No activity yet</div>;
  }

  return (
    <div className="activity-timeline">
      {recent.map((ev, i) => {
        const time = new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        });
        const icon = EVENT_ICONS[ev.eventType] ?? "\u25CF";
        const label =
          ev.eventType === "toolCallStart"
            ? `${(ev.payload.toolName as string) ?? "tool"} ${String(typeof ev.payload.toolInput === "object" ? JSON.stringify(ev.payload.toolInput) : ev.payload.toolInput ?? "").slice(0, 30)}`
            : ev.eventType;

        return (
          <div key={i} className="timeline-entry">
            <span className="timeline-time">{time}</span>
            <span className="timeline-icon">{icon}</span>
            <span className="timeline-label">{label}</span>
          </div>
        );
      })}
    </div>
  );
}
