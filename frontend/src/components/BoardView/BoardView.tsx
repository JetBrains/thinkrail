import { useCallback, useState } from "react";
import { Plus } from "lucide-react";
import { useBoardStore } from "@/store/boardStore.ts";
import type { TicketSummary } from "@/types/board.ts";
import { TicketBoard } from "./TicketBoard.tsx";
import { CreateTicketModal } from "./CreateTicketModal.tsx";
import { BoardTwoPanelLayout } from "./BoardTwoPanelLayout.tsx";
import { BoardTicketPreview } from "@/components/TicketDetail/BoardTicketPreview.tsx";
import { Button } from "@/components/ui/Button";
import "./BoardView.css";

interface BoardViewProps {
  onOpenTicket: (id: string) => void;
  onPreviewTicket: (id: string) => void;
}

export function BoardView({ onOpenTicket, onPreviewTicket }: BoardViewProps) {
  const tickets = useBoardStore((s) => s.tickets);
  const loading = useBoardStore((s) => s.loading);
  const previewTicketId = useBoardStore((s) => s.previewTicketId);
  const [modalOpen, setModalOpen] = useState(false);

  const ticketList: TicketSummary[] = Array.from(tickets.values());

  const handleOpenModal = useCallback(() => setModalOpen(true), []);
  const handleCloseModal = useCallback(() => setModalOpen(false), []);

  if (loading && ticketList.length === 0) {
    return <div className="center-placeholder">Loading board...</div>;
  }

  const boardContent = (
    <div className="board-section" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div className="board-section-header">
        <span className="board-section-title">Tickets</span>
        <Button
          variant="primary"
          size="sm"
          onClick={handleOpenModal}
          leadingIcon={<Plus size={16} strokeWidth={2} />}
        >
          New ticket
        </Button>
      </div>
      <TicketBoard tickets={ticketList} onOpenTicket={onOpenTicket} onPreviewTicket={onPreviewTicket} />
    </div>
  );

  const ticketPreview = previewTicketId ? (
    <BoardTicketPreview ticketId={previewTicketId} />
  ) : undefined;

  return (
    <>
      <BoardTwoPanelLayout
        leftPanel={boardContent}
        rightPanel={ticketPreview}
      />
      <CreateTicketModal open={modalOpen} onClose={handleCloseModal} />
    </>
  );
}
