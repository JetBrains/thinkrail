import type { ReactNode } from "react";
import { Modal, Button } from "@/components/ui/index.ts";
import "./ConfirmModal.css";

interface ConfirmModalProps {
  open: boolean;
  title: string;
  /** Body text or rich content explaining what the user is confirming. */
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Visual emphasis of the confirm button. */
  confirmVariant?: "primary" | "deny";
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * A small two-button confirmation dialog over the shared `Modal`. Used for
 * actions that silently change state and deserve an explicit "proceed?" —
 * e.g. switching a session to a model that can't honour the current effort or
 * context-window settings.
 */
export function ConfirmModal({
  open,
  title,
  message,
  confirmLabel = "Proceed",
  cancelLabel = "Cancel",
  confirmVariant = "primary",
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  return (
    <Modal open={open} onClose={onCancel}>
      <div className="confirm-modal" role="alertdialog" aria-label={title}>
        <h3 className="confirm-modal__title">{title}</h3>
        <div className="confirm-modal__body">{message}</div>
        <div className="confirm-modal__actions">
          <Button variant="cancel" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button variant={confirmVariant} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
