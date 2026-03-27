import { useCallback } from "react";
import type { MetaTicketSummary } from "@/types/board.ts";

interface MetaTicketCardProps {
  ticket: MetaTicketSummary;
  onOpen: (id: string) => void;
}

export function MetaTicketCard({ ticket, onOpen }: MetaTicketCardProps) {
  const handleClick = useCallback(() => {
    onOpen(ticket.id);
  }, [ticket.id, onOpen]);

  const specCount = ticket.linkedSpecIds.length;
  const hasPlan = ticket.planPath != null;

  return (
    <div className="ticket-card" onClick={handleClick}>
      <div className="ticket-card-title">{ticket.title}</div>
      <div className="ticket-card-meta">
        <span className={`ticket-card-type ticket-card-type--${ticket.type}`}>
          {ticket.type}
        </span>
      </div>
      {(specCount > 0 || hasPlan) && (
        <div className="ticket-card-stats">
          {specCount > 0 && `${specCount} spec${specCount !== 1 ? "s" : ""}`}
          {specCount > 0 && hasPlan && " \u00B7 "}
          {hasPlan && "has plan"}
        </div>
      )}
    </div>
  );
}
