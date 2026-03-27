import { useCallback, useMemo, useState } from "react";
import type { MetaTicket, MetaTicketStatus } from "@/types/board.ts";
import type { RightPanelContent } from "./MetaTicketDetail.tsx";
import { useSessionStore } from "@/store/sessionStore.ts";

interface TicketProgressBarProps {
  ticket: MetaTicket;
  plan?: Record<string, unknown> | null;
  onStartSession: (skillId: string) => void;
  onSelectPanel: (panel: RightPanelContent) => void;
}

const STATES: { key: MetaTicketStatus; label: string }[] = [
  { key: "idea", label: "Idea" },
  { key: "specified", label: "Specified" },
  { key: "planned", label: "Planned" },
  { key: "executing", label: "Executing" },
  { key: "done", label: "Done" },
];

const STATE_ORDER: Record<MetaTicketStatus, number> = {
  idea: 0,
  specified: 1,
  planned: 2,
  executing: 3,
  done: 4,
};

interface Action {
  label: string;
  onClick: () => void;
}

export function TicketProgressBar({ ticket, onStartSession, onSelectPanel }: TicketProgressBarProps) {
  const liveSessions = useSessionStore((s) => s.sessions);
  const [moreOpen, setMoreOpen] = useState(false);

  const currentIndex = STATE_ORDER[ticket.status] ?? 0;

  // Compute primary + secondary actions
  const { primary, secondary } = useMemo(() => {
    const sec: Action[] = [];
    let prim: Action | null = null;

    if (ticket.status === "done") {
      return { primary: null, secondary: [] };
    }

    if (ticket.status === "executing") {
      if (ticket.orchestratorSessionId && liveSessions.has(ticket.orchestratorSessionId)) {
        prim = {
          label: "Continue Execution",
          onClick: () => onSelectPanel({ type: "session", sessionId: ticket.orchestratorSessionId! }),
        };
      } else {
        prim = { label: "Start Executing", onClick: () => onStartSession("ticket-execute") };
      }
      sec.push({ label: "View plan", onClick: () => onSelectPanel({ type: "plan" }) });
      return { primary: prim, secondary: sec };
    }

    if (ticket.planPath) {
      prim = { label: "Start Executing", onClick: () => onStartSession("ticket-execute") };
      sec.push({ label: "Revise plan", onClick: () => onSelectPanel({ type: "plan" }) });
      sec.push({ label: "Add specs", onClick: () => onStartSession("ticket-specify") });
      return { primary: prim, secondary: sec };
    }

    if (ticket.status === "specified") {
      prim = { label: "Create Plan", onClick: () => onStartSession("ticket-plan") };
      sec.push({ label: "Add more specs", onClick: () => onStartSession("ticket-specify") });
      sec.push({ label: "Revise description", onClick: () => onSelectPanel({ type: "description" }) });
      return { primary: prim, secondary: sec };
    }

    if (ticket.status === "idea" && ticket.body) {
      prim = { label: "Specify", onClick: () => onStartSession("ticket-specify") };
      sec.push({ label: "Revise description", onClick: () => onSelectPanel({ type: "description" }) });
      return { primary: prim, secondary: sec };
    }

    prim = { label: "Describe", onClick: () => onSelectPanel({ type: "description" }) };
    return { primary: prim, secondary: sec };
  }, [ticket, liveSessions, onStartSession, onSelectPanel]);

  const handleMoreClick = useCallback(() => setMoreOpen((o) => !o), []);
  const handleMoreAction = useCallback((action: Action) => {
    action.onClick();
    setMoreOpen(false);
  }, []);

  return (
    <div className="ticket-progress-bar">
      {/* State pipeline */}
      <div className="ticket-progress-pipeline">
        {STATES.map((state, i) => {
          const isPast = i < currentIndex;
          const isCurrent = i === currentIndex;
          const cls = isPast ? "past" : isCurrent ? "current" : "future";
          return (
            <div key={state.key} className="ticket-progress-step">
              {i > 0 && <div className={`ticket-progress-line ticket-progress-line--${isPast || isCurrent ? "done" : "pending"}`} />}
              <div className={`ticket-progress-dot ticket-progress-dot--${cls}`} />
              <span className={`ticket-progress-label ticket-progress-label--${cls}`}>
                {state.label}
              </span>
            </div>
          );
        })}
      </div>

      {/* Actions */}
      <div className="ticket-progress-actions">
        {primary && (
          <button className="ticket-progress-primary" onClick={primary.onClick}>
            {primary.label}
          </button>
        )}
        {secondary.length > 0 && (
          <div className="ticket-progress-more-wrapper">
            <button className="ticket-progress-more" onClick={handleMoreClick}>
              More {"\u25BE"}
            </button>
            {moreOpen && (
              <div className="ticket-progress-dropdown">
                {secondary.map((action) => (
                  <button
                    key={action.label}
                    className="ticket-progress-dropdown-item"
                    onClick={() => handleMoreAction(action)}
                  >
                    {action.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
