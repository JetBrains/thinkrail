import "./Modal.css";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  /** "center" (default) vertically centers the content; "top" pins it near the top. */
  align?: "center" | "top";
}

export function Modal({ open, onClose, children, align = "center" }: ModalProps) {
  if (!open) return null;
  return (
    <div
      className={`modal-backdrop${align === "top" ? " modal-backdrop--top" : ""}`}
      onClick={onClose}
    >
      <div onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}
