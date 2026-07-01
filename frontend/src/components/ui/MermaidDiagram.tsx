import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ensureMermaid, mermaid } from "@/utils/mermaid.ts";
import { ZoomBar } from "@/utils/ZoomBar.tsx";
import "./MermaidDiagram.css";

/**
 * Renders Mermaid source to an inline, click-to-expand diagram. Clicking opens a
 * full-viewport overlay (portaled to <body>) with a floating zoom bar. Shared by
 * chat visualizations (VisualizationCard) and document previews (MarkdownPreview).
 */
export function MermaidDiagram({ syntax }: { syntax: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [svgHtml, setSvgHtml] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [fsZoom, setFsZoom] = useState(1);

  useEffect(() => {
    ensureMermaid();
    let cancelled = false;
    const id = `vis-mermaid-${Math.random().toString(36).slice(2, 9)}`;

    mermaid
      .render(id, syntax)
      .then(({ svg }) => {
        if (!cancelled && ref.current) {
          ref.current.innerHTML = svg;
          const svgEl = ref.current.querySelector("svg");
          if (svgEl) {
            svgEl.removeAttribute("width");
            svgEl.removeAttribute("height");
          }
          setSvgHtml(svg);
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(String(err));
      });

    return () => { cancelled = true; };
  }, [syntax]);

  const handleExpand = useCallback(() => {
    if (svgHtml) { setFsZoom(1); setFullscreen(true); }
  }, [svgHtml]);

  useEffect(() => {
    if (!fullscreen) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") setFullscreen(false); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [fullscreen]);

  if (error) {
    return (
      <div className="vis-diagram">
        <pre className="vis-diagram-text" style={{ color: "var(--red)" }}>{error}</pre>
        <pre className="vis-diagram-text">{syntax}</pre>
      </div>
    );
  }

  return (
    <>
      {fullscreen && svgHtml && createPortal(
        <div className="vis-fs-backdrop" onClick={() => setFullscreen(false)}>
          <div className="vis-fs-modal" onClick={(e) => e.stopPropagation()}>
            <ZoomBar
              zoom={fsZoom}
              onZoomIn={() => setFsZoom((z) => Math.min(z + 0.15, 4))}
              onZoomOut={() => setFsZoom((z) => Math.max(z - 0.15, 0.2))}
              onReset={() => setFsZoom(1)}
              className="vis-fs-zoombar"
            />
            <button className="vis-fs-close" onClick={() => setFullscreen(false)} title="Close (Esc)">×</button>
            <div className="vis-fs-scroll">
              <div
                className="vis-fs-svg"
                style={{ zoom: fsZoom }}
                dangerouslySetInnerHTML={{ __html: svgHtml }}
              />
            </div>
          </div>
        </div>,
        document.body,
      )}
      <div
        className="vis-mermaid-wrapper vis-mermaid-expandable"
        onClick={handleExpand}
        title="Click to expand"
      >
        <div ref={ref} className="vis-mermaid-inner" />
        {svgHtml && <span className="vis-mermaid-expand-hint">⛶</span>}
      </div>
    </>
  );
}
