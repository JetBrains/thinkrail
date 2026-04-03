import { useEffect, useRef } from "react";
import type { MetaTicketSummary, MetaTicketStatus, MetaTicketType } from "@/types/board.ts";

const VALID_TRANSITIONS: Record<MetaTicketStatus, MetaTicketStatus[]> = {
  idea: ["described", "done"],
  described: ["idea", "specified", "done"],
  specified: ["described", "planned", "done"],
  planned: ["specified", "executing", "done"],
  executing: ["planned", "done"],
  done: ["idea", "executing"],
};

const ALL_TYPES: MetaTicketType[] = ["feature", "bug", "idea", "improvement"];

interface BoardCardContextMenuProps {
  ticket: MetaTicketSummary;
  x: number;
  y: number;
  onClose: () => void;
  onOpen: (id: string) => void;
  onUpdateTicket: (id: string, updates: { status?: MetaTicketStatus; type?: MetaTicketType }) => void;
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

  const validStatuses = VALID_TRANSITIONS[ticket.status] ?? [];

  return (
    <div ref={ref} className="board-ctx-menu" style={{ left: x, top: y }}>
      <button className="board-ctx-menu-item" onClick={() => { onOpen(ticket.id); onClose(); }}>
        Open
      </button>

      <div className="board-ctx-menu-sep" />

      <div className="board-ctx-menu-label">Status</div>
      {validStatuses.map((s) => (
        <button
          key={s}
          className="board-ctx-menu-item board-ctx-menu-item--indent"
          onClick={() => { onUpdateTicket(ticket.id, { status: s }); onClose(); }}
        >
          {s}
        </button>
      ))}

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
