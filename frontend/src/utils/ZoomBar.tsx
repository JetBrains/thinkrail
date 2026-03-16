/** Reusable zoom controls — shared by MarkdownPreview and VisualizationCard.
 *
 * Uses the `.md-zoom-*` CSS classes defined in FileViewer.css (loaded globally).
 */

export function ZoomBar({
  zoom,
  onZoomIn,
  onZoomOut,
  onReset,
  className,
}: {
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
  className?: string;
}) {
  return (
    <div className={`md-zoom-bar ${className ?? ""}`}>
      <button className="md-zoom-btn" onClick={onZoomOut} title="Zoom out">
        −
      </button>
      <span className="md-zoom-level" onClick={onReset} title="Reset zoom">
        {Math.round(zoom * 100)}%
      </span>
      <button className="md-zoom-btn" onClick={onZoomIn} title="Zoom in">
        +
      </button>
    </div>
  );
}
