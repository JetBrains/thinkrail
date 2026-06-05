import { createContext, useContext, useEffect, useRef, useState, type ComponentPropsWithoutRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkFrontmatter from "remark-frontmatter";
import { ensureMermaid, mermaid } from "@/utils/mermaid.ts";
import { FrontmatterCard, extractFrontmatter } from "./FrontmatterCard";
import { ZoomBar } from "@/utils/ZoomBar.tsx";
import { Modal } from "@/components/ui/Modal.tsx";

// Context to pass document zoom level to child components
const DocZoomContext = createContext(1);

// ── Mermaid Block with zoom + popup ──

/**
 * Render the Mermaid source into a div via mermaid.render(). Caller
 * controls the wrapping div (sizing, scrolling, scale). Returns the
 * rendered ref so the parent can compose. Used twice per diagram —
 * once inline, once again in the expand-modal — so the SVG stays
 * crisp at the modal's larger size.
 */
function useMermaidRender(code: string) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    ensureMermaid();
    let cancelled = false;
    const id = `mermaid-${Math.random().toString(36).slice(2, 9)}`;

    mermaid
      .render(id, code)
      .then(({ svg }) => {
        if (!cancelled && ref.current) {
          ref.current.innerHTML = svg;
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

  return { ref, error };
}

function MermaidBlock({ code }: { code: string }) {
  const { ref, error } = useMermaidRender(code);
  const [localZoom, setLocalZoom] = useState(1);
  const [expanded, setExpanded] = useState(false);
  const docZoom = useContext(DocZoomContext);

  // ESC closes the popup — Modal itself only handles backdrop click.
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpanded(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded]);

  if (error) {
    return (
      <pre className="md-mermaid-error">
        <code>{code}</code>
        <div className="md-mermaid-error-msg">{error}</div>
      </pre>
    );
  }

  const combinedScale = docZoom * localZoom;

  return (
    <div className="md-mermaid-wrapper">
      <ZoomBar
        zoom={localZoom}
        onZoomIn={() => setLocalZoom((z) => Math.min(z + 0.15, 3))}
        onZoomOut={() => setLocalZoom((z) => Math.max(z - 0.15, 0.3))}
        onReset={() => setLocalZoom(1)}
        onPopout={() => setExpanded(true)}
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
      <Modal open={expanded} onClose={() => setExpanded(false)}>
        <MermaidPopupContent code={code} onClose={() => setExpanded(false)} />
      </Modal>
    </div>
  );
}

function MermaidPopupContent({ code, onClose }: { code: string; onClose: () => void }) {
  const { ref, error } = useMermaidRender(code);
  const [zoom, setZoom] = useState(1);
  return (
    <div className="md-mermaid-popup">
      <div className="md-mermaid-popup-bar">
        <ZoomBar
          zoom={zoom}
          onZoomIn={() => setZoom((z) => Math.min(z + 0.2, 4))}
          onZoomOut={() => setZoom((z) => Math.max(z - 0.2, 0.3))}
          onReset={() => setZoom(1)}
        />
        <button
          type="button"
          className="md-mermaid-popup-close"
          onClick={onClose}
          title="Close (Esc)"
          aria-label="Close"
        >
          ×
        </button>
      </div>
      <div className="md-mermaid-popup-body">
        {error ? (
          <pre className="md-mermaid-error">
            <code>{code}</code>
            <div className="md-mermaid-error-msg">{error}</div>
          </pre>
        ) : (
          <div
            ref={ref}
            // Block-level + full-width so the SVG (rendered with
            // width="100%" by mermaid) fills the popup horizontally
            // instead of sitting at its intrinsic small size.
            style={{
              transform: `scale(${zoom})`,
              transformOrigin: "top left",
              display: "block",
              width: "100%",
            }}
          />
        )}
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
  /** Document zoom level — driven by the FileViewer toolbar's zoom control. */
  zoom?: number;
}

export function MarkdownPreview({ content, zoom = 1 }: MarkdownPreviewProps) {
  const frontmatter = extractFrontmatter(content);

  return (
    <DocZoomContext.Provider value={zoom}>
      <div className="md-preview-container">
        <div className="md-preview" style={{ fontSize: `${zoom * 13}px` }}>
          <FrontmatterCard value={frontmatter ?? undefined} />
          <ReactMarkdown
            remarkPlugins={[remarkGfm, remarkFrontmatter]}
            components={{ code: CodeBlock }}
          >
            {content}
          </ReactMarkdown>
        </div>
      </div>
    </DocZoomContext.Provider>
  );
}
