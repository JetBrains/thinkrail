import { useCallback, useRef } from "react";

interface ResizeHandleProps {
  side: "left" | "right";
  panelWidth: number;
  onResize: (width: number) => void;
  onCollapse: () => void;
  min: number;
  max?: number;
  collapseThreshold: number;
  /** Drag still works, but no visible divider line is drawn. */
  invisible?: boolean;
}

export function ResizeHandle({
  side,
  panelWidth,
  onResize,
  onCollapse,
  min,
  max,
  collapseThreshold,
  invisible,
}: ResizeHandleProps) {
  const dragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragging.current = true;
      startX.current = e.clientX;
      startWidth.current = panelWidth;

      const onMouseMove = (ev: MouseEvent) => {
        if (!dragging.current) return;
        const delta =
          side === "left"
            ? ev.clientX - startX.current
            : startX.current - ev.clientX;
        const newWidth = startWidth.current + delta;

        if (newWidth < collapseThreshold) {
          onCollapse();
          dragging.current = false;
          document.removeEventListener("mousemove", onMouseMove);
          document.removeEventListener("mouseup", onMouseUp);
          return;
        }

        onResize(Math.max(min, max != null ? Math.min(max, newWidth) : newWidth));
      };

      const onMouseUp = () => {
        dragging.current = false;
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
      };

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    },
    [side, panelWidth, onResize, onCollapse, min, max, collapseThreshold],
  );

  return (
    <div
      className="resize-handle"
      onMouseDown={onMouseDown}
      style={{
        width: 4,
        cursor: "col-resize",
        background: invisible ? "transparent" : "var(--border)",
        flexShrink: 0,
        transition: "background var(--transition-fast)",
      }}
      onMouseEnter={(e) => {
        if (!invisible) (e.target as HTMLElement).style.background = "var(--blue)";
      }}
      onMouseLeave={(e) => {
        if (!invisible) (e.target as HTMLElement).style.background = "var(--border)";
      }}
    />
  );
}
