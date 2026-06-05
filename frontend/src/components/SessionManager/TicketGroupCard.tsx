import type { TicketGroup } from "./groupByTicket.ts";
import { timeAgo } from "@/utils/format.ts";

interface TicketGroupCardProps {
  group: TicketGroup;
  title: string;
  shortId: string;
  onOpen: (group: TicketGroup) => void;
}

/** Left-panel ticket card (the "Tickets" section of SessionManager). Dark
 *  card surface with a purple lead stripe; opening it routes to the ticket. */
export function TicketGroupCard({ group, title, shortId, onOpen }: TicketGroupCardProps) {
  const count = group.sessions.length;
  // Status: attention beats running beats idle. Mirrors the focus rule
  // (land on whichever session needs the user first).
  const needsAttention = group.attentionCount > 0;
  const running = !needsAttention && group.runningCount > 0;
  const statusLabel = needsAttention
    ? `${group.attentionCount} needs attention`
    : running
      ? `${group.runningCount} running`
      : "idle";
  const classes = [
    "sm-card",
    "sm-card--ticket-group",
    needsAttention && "sm-card--needs-attention",
    running && "sm-card--running",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={classes}
      role="button"
      tabIndex={0}
      onClick={() => onOpen(group)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(group);
        }
      }}
    >
      <span className="sm-ticket-stripe sm-ticket-stripe--lead" aria-hidden="true" />
      <span className="sm-name" title={title}>{title}</span>
      <span className="sm-ticket-id">{shortId}</span>
      <span className="sm-time">{timeAgo(group.latestActivity)}</span>
      <span className="sm-metrics">
        <span className="sm-chip" title="Sessions attached to this ticket">
          {count} {count === 1 ? "session" : "sessions"}
        </span>
      </span>
      <span className="sm-actions">
        <span className={`sm-status-label${needsAttention ? " sm-status-label--attention" : running ? " sm-status-label--running" : ""}`}>
          {statusLabel}
        </span>
      </span>
    </div>
  );
}
