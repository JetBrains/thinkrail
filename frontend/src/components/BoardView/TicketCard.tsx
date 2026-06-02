import { useCallback } from "react";
import { useSortable } from "@dnd-kit/react/sortable";
import type { TicketSummary } from "@/types/board.ts";

interface TicketCardProps {
  ticket: TicketSummary;
  index: number;
  column: string;
  onOpen: (id: string) => void;
  onContextMenu?: (e: React.MouseEvent, id: string) => void;
}

export function TicketCard({ ticket, index, column, onOpen, onContextMenu }: TicketCardProps) {
  const { ref, isDragSource } = useSortable({
    id: ticket.id,
    index,
    group: column,
    type: "item",
    accept: "item",
    data: { ticket },
  });

  const handleClick = useCallback(() => {
    onOpen(ticket.id);
  }, [ticket.id, onOpen]);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      if (onContextMenu) {
        e.preventDefault();
        onContextMenu(e, ticket.id);
      }
    },
    [ticket.id, onContextMenu],
  );

  const specCount = ticket.linkedSpecIds.length;
  const hasPlan = ticket.implementationPlanPath != null;

  return (
    <div
      ref={ref}
      className={`ticket-card ${isDragSource ? "ticket-card--dragging" : ""}`}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
    >
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
