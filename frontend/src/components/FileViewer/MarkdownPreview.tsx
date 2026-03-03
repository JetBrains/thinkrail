import { createContext, useCallback, useContext, useEffect, useRef, useState, type ComponentPropsWithoutRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import mermaid from "mermaid";

// Initialize mermaid once with dark theme matching our JetBrains palette
let mermaidInitialized = false;
function ensureMermaid() {
  if (mermaidInitialized) return;
  mermaid.initialize({
    startOnLoad: false,
    theme: "dark",
    themeVariables: {
      primaryColor: "#393b40",
      primaryTextColor: "#dfe1e5",
      primaryBorderColor: "#43454a",
      lineColor: "#6f737a",
      secondaryColor: "#2b2d30",
      tertiaryColor: "#1e1f22",
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: "16px",
    },
  });
  mermaidInitialized = true;
}

// Context to pass document zoom level to child components
const DocZoomContext = createContext(1);

// ── Zoom Controls (reusable) ──

function ZoomBar({
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

// ── Mermaid Block with zoom ──

function MermaidBlock({ code }: { code: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [localZoom, setLocalZoom] = useState(1);
  const docZoom = useContext(DocZoomContext);

  useEffect(() => {
    ensureMermaid();
    let cancelled = false;
    const id = `mermaid-${Math.random().toString(36).slice(2, 9)}`;

    mermaid
      .render(id, code)
      .then(({ svg }) => {
        if (!cancelled && ref.current) {
          ref.current.innerHTML = svg;
          // Make SVG fill container width instead of fixed internal size
          const svgEl = ref.current.querySelector("svg");
          if (svgEl) {
            svgEl.setAttribute("width", "100%");
            svgEl.removeAttribute("height");
            svgEl.style.maxWidth = "100%";
          }
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(String(err));
      });

    return () => {
      cancelled = true;
    };
  }, [code]);

  if (error) {
    return (
      <pre className="md-mermaid-error">
        <code>{code}</code>
        <div className="md-mermaid-error-msg">{error}</div>
      </pre>
    );
  }

  // Combined scale: document zoom × per-diagram zoom
  const combinedScale = docZoom * localZoom;

  return (
    <div className="md-mermaid-wrapper">
      <ZoomBar
        zoom={localZoom}
        onZoomIn={() => setLocalZoom((z) => Math.min(z + 0.15, 3))}
        onZoomOut={() => setLocalZoom((z) => Math.max(z - 0.15, 0.3))}
        onReset={() => setLocalZoom(1)}
        className="md-mermaid-zoom"
      />
      <div className="md-mermaid" style={{ overflow: "auto" }}>
        <div
          ref={ref}
          style={{
            transform: `scale(${combinedScale})`,
            transformOrigin: "top left",
            display: "inline-block",
          }}
        />
      </div>
    </div>
  );
}

// ── Code Block Router ──

function CodeBlock({ className, children, ...props }: ComponentPropsWithoutRef<"code">) {
  const match = /language-(\w+)/.exec(className || "");
  const lang = match?.[1];
  const code = String(children).replace(/\n$/, "");

  if (lang === "mermaid") {
    return <MermaidBlock code={code} />;
  }

  return (
    <code className={className} {...props}>
      {children}
    </code>
  );
}

// ── Main Preview ──

interface MarkdownPreviewProps {
  content: string;
}

export function MarkdownPreview({ content }: MarkdownPreviewProps) {
  const [zoom, setZoom] = useState(1);

  const zoomIn = useCallback(() => setZoom((z) => Math.min(z + 0.1, 2)), []);
  const zoomOut = useCallback(() => setZoom((z) => Math.max(z - 0.1, 0.5)), []);
  const resetZoom = useCallback(() => setZoom(1), []);

  return (
    <DocZoomContext.Provider value={zoom}>
      <div className="md-preview-container">
        <ZoomBar
          zoom={zoom}
          onZoomIn={zoomIn}
          onZoomOut={zoomOut}
          onReset={resetZoom}
          className="md-global-zoom"
        />
        <div className="md-preview" style={{ fontSize: `${zoom * 13}px` }}>
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{ code: CodeBlock }}
          >
            {content}
          </ReactMarkdown>
        </div>
      </div>
    </DocZoomContext.Provider>
  );
}
