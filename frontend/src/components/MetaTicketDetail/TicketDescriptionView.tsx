import { useCallback, useState } from "react";
import type { MetaTicket } from "@/types/board.ts";
import { useBoardStore } from "@/store/boardStore.ts";

interface TicketDescriptionViewProps {
  ticket: MetaTicket;
  onTicketUpdated?: (ticket: MetaTicket) => void;
}

export function TicketDescriptionView({ ticket, onTicketUpdated }: TicketDescriptionViewProps) {
  const updateTicket = useBoardStore((s) => s.updateTicket);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(ticket.body);

  const handleEdit = useCallback(() => {
    setDraft(ticket.body);
    setEditing(true);
  }, [ticket.body]);

  const handleSave = useCallback(async () => {
    const updated = await updateTicket(ticket.id, { body: draft });
    onTicketUpdated?.(updated as MetaTicket);
    setEditing(false);
  }, [ticket.id, draft, updateTicket, onTicketUpdated]);

  return (
    <div className="ticket-right-panel">
      <div className="ticket-right-header">
        <span className="ticket-right-title">Description</span>
        {!editing && (
          <button className="ticket-section-action" onClick={handleEdit}>
            Edit
          </button>
        )}
      </div>
      <div className="ticket-right-body">
        {editing ? (
          <>
            <textarea
              className="ticket-description-edit ticket-description-edit--full"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              autoFocus
            />
            <div className="ticket-right-actions">
              <button className="ticket-section-action" onClick={() => setEditing(false)}>
                Cancel
              </button>
              <button className="ticket-section-action ticket-section-action--primary" onClick={handleSave}>
                Save
              </button>
            </div>
          </>
        ) : (
          <div
            className={`ticket-description-full ${!ticket.body ? "ticket-description-empty" : ""}`}
            onClick={handleEdit}
          >
            {ticket.body || "Click to add a description..."}
          </div>
        )}
      </div>
    </div>
  );
}
