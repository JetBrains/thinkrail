import { useEffect, useRef, useState, type ComponentPropsWithoutRef } from "react";
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
      fontSize: "13px",
    },
  });
  mermaidInitialized = true;
}

/** Renders a single mermaid code block as SVG. */
function MermaidBlock({ code }: { code: string }) {
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

  return <div ref={ref} className="md-mermaid" />;
}

/** Custom code block renderer — Mermaid blocks get rendered as SVG, others as <pre><code>. */
function CodeBlock({ className, children, ...props }: ComponentPropsWithoutRef<"code">) {
  const match = /language-(\w+)/.exec(className || "");
  const lang = match?.[1];
  const code = String(children).replace(/\n$/, "");

  if (lang === "mermaid") {
    return <MermaidBlock code={code} />;
  }

  // Regular code block
  return (
    <code className={className} {...props}>
      {children}
    </code>
  );
}

interface MarkdownPreviewProps {
  content: string;
}

export function MarkdownPreview({ content }: MarkdownPreviewProps) {
  return (
    <div className="md-preview">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{ code: CodeBlock }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
