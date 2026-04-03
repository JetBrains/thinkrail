import { useCallback, useMemo, useState } from "react";
import type { MetaTicket, MetaTicketStatus } from "@/types/board.ts";
import type { RightPanelContent } from "./MetaTicketDetail.tsx";
import { useSessionStore } from "@/store/sessionStore.ts";

interface TicketProgressBarProps {
  ticket: MetaTicket;
  onStartSession: (skillId: string) => void;
  onSelectPanel: (panel: RightPanelContent) => void;
}

const STATES: { key: MetaTicketStatus; label: string }[] = [
  { key: "idea", label: "Idea" },
  { key: "described", label: "Described" },
  { key: "specified", label: "Specified" },
  { key: "planned", label: "Planned" },
  { key: "executing", label: "Executing" },
  { key: "done", label: "Done" },
];

const STATE_ORDER: Record<MetaTicketStatus, number> = {
  idea: 0,
  described: 1,
  specified: 2,
  planned: 3,
  executing: 4,
  done: 5,
};

interface Action {
  label: string;
  onClick: () => void;
}

export function TicketProgressBar({ ticket, onStartSession, onSelectPanel }: TicketProgressBarProps) {
  const liveSessions = useSessionStore((s) => s.sessions);
  const [moreOpen, setMoreOpen] = useState(false);

  const currentIndex = STATE_ORDER[ticket.status] ?? 0;

  // Compute primary + secondary actions — purely state-driven
  const { primary, secondary } = useMemo(() => {
    const sec: Action[] = [];
    let prim: Action | null = null;

    switch (ticket.status) {
      case "idea":
        prim = { label: "Describe with AI", onClick: () => onStartSession("ticket-describe") };
        sec.push({ label: "Edit Description", onClick: () => onSelectPanel({ type: "description" }) });
        break;

      case "described":
        prim = { label: "Specify with AI", onClick: () => onStartSession("ticket-specify") };
        sec.push({ label: "Edit Description", onClick: () => onSelectPanel({ type: "description" }) });
        sec.push({ label: "Revise with AI", onClick: () => onStartSession("ticket-describe") });
        break;

      case "specified":
        prim = { label: "Plan with AI", onClick: () => onStartSession("ticket-plan") };
        sec.push({ label: "Add more specs", onClick: () => onStartSession("ticket-specify") });
        sec.push({ label: "Edit Description", onClick: () => onSelectPanel({ type: "description" }) });
        break;

      case "planned":
        prim = { label: "Execute", onClick: () => onStartSession("ticket-execute") };
        sec.push({ label: "Revise plan", onClick: () => onSelectPanel({ type: "plan" }) });
        sec.push({ label: "Add specs", onClick: () => onStartSession("ticket-specify") });
        break;

      case "executing":
        if (ticket.orchestratorSessionId && liveSessions.has(ticket.orchestratorSessionId)) {
          prim = {
            label: "Continue",
            onClick: () => onSelectPanel({ type: "session", sessionId: ticket.orchestratorSessionId! }),
          };
        } else {
          prim = { label: "Execute", onClick: () => onStartSession("ticket-execute") };
        }
        sec.push({ label: "View plan", onClick: () => onSelectPanel({ type: "plan" }) });
        break;

      case "done":
        // No actions for completed tickets
        break;
    }

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
