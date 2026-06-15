import { useEffect, useRef } from "react";
import type { TicketSummary, TicketType } from "@/types/board.ts";

const ALL_TYPES: TicketType[] = ["feature", "bug", "idea", "improvement"];

interface BoardCardContextMenuProps {
  ticket: TicketSummary;
  x: number;
  y: number;
  onClose: () => void;
  onOpen: (id: string) => void;
  onUpdateTicket: (id: string, updates: { type?: TicketType }) => void;
  onDeleteTicket: (id: string) => void;
}

export function BoardCardContextMenu({
  ticket, x, y, onClose, onOpen, onUpdateTicket, onDeleteTicket,
}: BoardCardContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [onClose]);

  return (
    <div ref={ref} className="board-ctx-menu" style={{ left: x, top: y }}>
      <button className="board-ctx-menu-item" onClick={() => { onOpen(ticket.id); onClose(); }}>
        Open
      </button>

      <div className="board-ctx-menu-sep" />

      <div className="board-ctx-menu-label">Type</div>
      {ALL_TYPES.filter((t) => t !== ticket.type).map((t) => (
        <button
          key={t}
          className="board-ctx-menu-item board-ctx-menu-item--indent"
          onClick={() => { onUpdateTicket(ticket.id, { type: t }); onClose(); }}
        >
          {t}
        </button>
      ))}

      <div className="board-ctx-menu-sep" />

      <button
        className="board-ctx-menu-item board-ctx-menu-item--danger"
        onClick={() => {
          if (window.confirm(`Delete ticket "${ticket.title}"?`)) {
            onDeleteTicket(ticket.id);
          }
          onClose();
        }}
      >
        Delete
      </button>
    </div>
  );
}
