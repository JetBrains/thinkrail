import { useCallback, useEffect, useState } from "react";
import { useBoardStore } from "@/store/boardStore.ts";
import type { MetaTicketType } from "@/types/board.ts";
import { Modal } from "@/components/ui/index.ts";

interface CreateTicketModalProps {
  open: boolean;
  onClose: () => void;
}

export function CreateTicketModal({ open, onClose }: CreateTicketModalProps) {
  const createTicket = useBoardStore((s) => s.createTicket);
  const [title, setTitle] = useState("");
  const [type, setType] = useState<MetaTicketType>("feature");
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) {
      setTitle("");
      setType("feature");
      setBody("");
      setSubmitting(false);
    }
  }, [open]);

  const handleSubmit = useCallback(async () => {
    if (!title.trim() || submitting) return;
    setSubmitting(true);
    try {
      await createTicket(title.trim(), body.trim() || undefined, type);
      onClose();
    } catch (e) {
      console.error("[CreateTicketModal] Error:", e);
      setSubmitting(false);
    }
  }, [title, body, type, submitting, createTicket, onClose]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleSubmit();
      if (e.key === "Escape") onClose();
    },
    [handleSubmit, onClose],
  );

  return (
    <Modal open={open} onClose={onClose}>
      <div className="create-ticket-modal" onKeyDown={handleKeyDown}>
        <h3>New Meta-Ticket</h3>

        <div className="create-ticket-field">
          <label>Title</label>
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="What do you want to build or fix?"
          />
        </div>

        <div className="create-ticket-field">
          <label>Type</label>
          <select value={type} onChange={(e) => setType(e.target.value as MetaTicketType)}>
            <option value="feature">Feature</option>
            <option value="bug">Bug</option>
            <option value="idea">Idea</option>
            <option value="improvement">Improvement</option>
          </select>
        </div>

        <div className="create-ticket-field">
          <label>Description (optional)</label>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Describe the intention..."
            rows={3}
          />
        </div>

        <div className="create-ticket-actions">
          <button onClick={onClose}>Cancel</button>
          <button
            className="primary"
            onClick={handleSubmit}
            disabled={!title.trim() || submitting}
          >
            {submitting ? "Creating..." : "Create"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
