import { useEffect, useRef } from "react";

interface SessionCardContextMenuProps {
  bonsaiSid: string;
  ticketId: string | null;
  x: number;
  y: number;
  onClose: () => void;
  onOpenTicket: (ticketId: string, bonsaiSid: string) => void;
  onCopySid: (bonsaiSid: string) => void;
}

export function SessionCardContextMenu({
  bonsaiSid,
  ticketId,
  x,
  y,
  onClose,
  onOpenTicket,
  onCopySid,
}: SessionCardContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleMouseDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKey);
    };
  }, [onClose]);

  return (
    <div ref={ref} className="sm-ctx-menu" style={{ left: x, top: y }}>
      {ticketId && (
        <button
          className="sm-ctx-menu-item"
          onClick={() => { onOpenTicket(ticketId, bonsaiSid); onClose(); }}
        >
          Open ticket
        </button>
      )}
      <button
        className="sm-ctx-menu-item sm-ctx-menu-item--id"
        onClick={() => { onCopySid(bonsaiSid); onClose(); }}
        title={`Click to copy: ${bonsaiSid}`}
      >
        Session ID: <span className="sm-ctx-menu-id-text">{bonsaiSid}</span>
        <svg
          className="sm-ctx-menu-id-icon"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <rect x="5" y="5" width="9" height="9" rx="1.5" />
          <path d="M3.5 11V3.5A1.5 1.5 0 0 1 5 2h6.5" />
        </svg>
      </button>
    </div>
  );
}
