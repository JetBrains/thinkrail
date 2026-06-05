import { useCallback, useState } from "react";
import { useBoardStore } from "@/store/boardStore.ts";
import type { TicketSummary } from "@/types/board.ts";
import { TicketBoard } from "./TicketBoard.tsx";
import { CreateTicketModal } from "./CreateTicketModal.tsx";
import "./BoardView.css";

interface BoardViewProps {
  onOpenTicket: (id: string) => void;
  onPreviewTicket: (id: string) => void;
}

export function BoardView({ onOpenTicket, onPreviewTicket }: BoardViewProps) {
  const tickets = useBoardStore((s) => s.tickets);
  const loading = useBoardStore((s) => s.loading);
  const [modalOpen, setModalOpen] = useState(false);

  const ticketList: TicketSummary[] = Array.from(tickets.values());

  const handleOpenModal = useCallback(() => setModalOpen(true), []);
  const handleCloseModal = useCallback(() => setModalOpen(false), []);

  if (loading && ticketList.length === 0) {
    return <div className="center-placeholder">Loading board...</div>;
  }

  return (
    <div className="board-view">
      <div className="board-section" style={{ flex: 1 }}>
        <div className="board-section-header">
          <span className="board-section-title">Tickets</span>
          <button className="board-new-btn" onClick={handleOpenModal}>
            + New ticket
          </button>
        </div>
        <TicketBoard tickets={ticketList} onOpenTicket={onOpenTicket} onPreviewTicket={onPreviewTicket} />
      </div>

      <CreateTicketModal open={modalOpen} onClose={handleCloseModal} />
    </div>
  );
}
