import { useCallback, useEffect, useState } from "react";
import { useBoardStore } from "@/store/boardStore.ts";
import type { TicketType } from "@/types/board.ts";
import { Modal, Button, Input, Select, type SelectOption } from "@/components/ui/index.ts";

interface CreateTicketModalProps {
  open: boolean;
  onClose: () => void;
}

const TYPE_OPTIONS: SelectOption[] = [
  { label: "Feature", value: "feature" },
  { label: "Bug", value: "bug" },
  { label: "Idea", value: "idea" },
  { label: "Improvement", value: "improvement" },
];

export function CreateTicketModal({ open, onClose }: CreateTicketModalProps) {
  const createTicket = useBoardStore((s) => s.createTicket);
  const [title, setTitle] = useState("");
  const [type, setType] = useState<TicketType>("feature");
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
          <Input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Ticket"
          />
        </div>

        <div className="create-ticket-field">
          <label>Type</label>
          <Select
            value={type}
            options={TYPE_OPTIONS}
            onChange={(value) => setType(value as TicketType)}
          />
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
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            onClick={handleSubmit}
            disabled={!title.trim() || submitting}
          >
            {submitting ? "Creating..." : "Create"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
