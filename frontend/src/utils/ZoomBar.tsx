/** Reusable zoom controls — shared by MarkdownPreview and VisualizationCard.
 *
 * Uses the `.md-zoom-*` CSS classes defined in FileViewer.css (loaded globally).
 */

export function ZoomBar({
  zoom,
  onZoomIn,
  onZoomOut,
  onReset,
  onPopout,
  className,
}: {
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
  onPopout?: () => void;
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
      {onPopout && (
        <>
          <span className="md-zoom-sep" />
          <button className="md-zoom-btn" onClick={onPopout} title="Open in new window">
            ⧉
          </button>
        </>
      )}
    </div>
  );
}
