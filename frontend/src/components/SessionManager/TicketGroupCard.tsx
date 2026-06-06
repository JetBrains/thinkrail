import type { TicketGroup } from "./groupByTicket.ts";
import { timeAgo } from "@/utils/format.ts";

interface TicketGroupCardProps {
  group: TicketGroup;
  title: string;
  shortId: string;
  onOpen: (group: TicketGroup) => void;
  /** Current phase label (e.g. "Product design") — the ticket's progress step. */
  phaseLabel: string;
  expanded: boolean;
  onToggleExpand: () => void;
}

/** Left-panel ticket card (the "Tickets" section of SessionManager) — a folder
 *  showing the ticket's current progress step. Dark surface with a purple lead
 *  stripe; the row opens the ticket, the chevron toggles the step's session. */
export function TicketGroupCard({ group, title, shortId, onOpen, phaseLabel, expanded, onToggleExpand }: TicketGroupCardProps) {
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
      <button
        type="button"
        className="sm-ticket-chevron"
        aria-label={expanded ? "Collapse sessions" : "Expand sessions"}
        aria-expanded={expanded}
        onClick={(e) => {
          e.stopPropagation();
          onToggleExpand();
        }}
      >
        {expanded ? "▾" : "▸"}
      </button>
      <span className="sm-name" title={title}>{title}</span>
      <span className="sm-ticket-id">{shortId}</span>
      <span className="sm-time">{timeAgo(group.latestActivity)}</span>
      <span className="sm-metrics">
        {phaseLabel && (
          <span className="sm-chip" title="Current phase">
            {phaseLabel}
          </span>
        )}
      </span>
      <span className="sm-actions">
        <span className={`sm-status-label${needsAttention ? " sm-status-label--attention" : running ? " sm-status-label--running" : ""}`}>
          {statusLabel}
        </span>
      </span>
    </div>
  );
}
