import { useCallback, useState } from "react";
import { useBoardStore } from "@/store/boardStore.ts";
import type { TicketSummary } from "@/types/board.ts";
import { TicketBoard } from "./TicketBoard.tsx";
import { TaskBoard } from "./TaskBoard.tsx";
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
  const [topRatio, setTopRatio] = useState(0.5);

  const ticketList: TicketSummary[] = Array.from(tickets.values());

  const handleOpenModal = useCallback(() => setModalOpen(true), []);
  const handleCloseModal = useCallback(() => setModalOpen(false), []);

  // Resize handler for split
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startY = e.clientY;
      const startRatio = topRatio;
      const container = (e.target as HTMLElement).parentElement;
      if (!container) return;
      const totalHeight = container.clientHeight;

      const handleMove = (ev: MouseEvent) => {
        const delta = ev.clientY - startY;
        const newRatio = Math.max(0.2, Math.min(0.8, startRatio + delta / totalHeight));
        setTopRatio(newRatio);
      };

      const handleUp = () => {
        document.removeEventListener("mousemove", handleMove);
        document.removeEventListener("mouseup", handleUp);
      };

      document.addEventListener("mousemove", handleMove);
      document.addEventListener("mouseup", handleUp);
    },
    [topRatio],
  );

  if (loading && ticketList.length === 0) {
    return <div className="center-placeholder">Loading board...</div>;
  }

  return (
    <div className="board-view">
      {/* Top: Tickets */}
      <div className="board-section" style={{ flex: `0 0 ${topRatio * 100}%` }}>
        <div className="board-section-header">
          <span className="board-section-title">Tickets</span>
          <button className="board-new-btn" onClick={handleOpenModal}>
            + New ticket
          </button>
        </div>
        <TicketBoard tickets={ticketList} onOpenTicket={onOpenTicket} onPreviewTicket={onPreviewTicket} />
      </div>

      {/* Resize handle */}
      <div className="board-resize-handle" onMouseDown={handleMouseDown}>
        <div className="board-resize-handle-grip" />
      </div>

      {/* Bottom: Implementation tasks */}
      <div className="board-section" style={{ flex: 1 }}>
        <TaskBoard />
      </div>

      <CreateTicketModal open={modalOpen} onClose={handleCloseModal} />
    </div>
  );
}
