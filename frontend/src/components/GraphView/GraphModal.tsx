import { useEffect } from "react";
import { createPortal } from "react-dom";
import { GraphView } from "./GraphView.tsx";
import "./GraphModal.css";

interface GraphModalProps {
  onClose: () => void;
}

export function GraphModal({ onClose }: GraphModalProps) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return createPortal(
    <div className="graph-modal-backdrop" onClick={onClose}>
      <div className="graph-modal" onClick={(e) => e.stopPropagation()}>
        <button className="graph-modal-close" onClick={onClose} title="Close (Esc)">
          ×
        </button>
        <GraphView />
      </div>
    </div>,
    document.body,
  );
}
