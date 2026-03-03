interface GraphControlsProps {
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
}

export function GraphControls({
  zoom,
  onZoomIn,
  onZoomOut,
  onFit,
}: GraphControlsProps) {
  return (
    <div className="graph-controls">
      <button className="graph-control-btn" onClick={onZoomIn} title="Zoom in">
        +
      </button>
      <span className="graph-control-zoom">{Math.round(zoom * 100)}%</span>
      <button className="graph-control-btn" onClick={onZoomOut} title="Zoom out">
        −
      </button>
      <button className="graph-control-btn" onClick={onFit} title="Fit to view">
        {"\u2299"}
      </button>
    </div>
  );
}
