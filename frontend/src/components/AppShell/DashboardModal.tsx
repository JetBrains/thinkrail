import { Modal } from "@/components/ui/index.ts";
import { VisTab } from "@/components/ContextPanel/modes/VisTab.tsx";
import "./DashboardModal.css";

interface DashboardModalProps {
  open: boolean;
  onClose: () => void;
}

export function DashboardModal({ open, onClose }: DashboardModalProps) {
  return (
    <Modal open={open} onClose={onClose}>
      <div
        className="dashboard-modal"
        onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}
      >
        <div className="dashboard-modal__header">
          <span className="dashboard-modal__title">Dashboard</span>
          <button
            className="dashboard-modal__close"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <div className="dashboard-modal__body">
          <VisTab />
        </div>
      </div>
    </Modal>
  );
}
