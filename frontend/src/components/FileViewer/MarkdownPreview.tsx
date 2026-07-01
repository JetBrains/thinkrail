import { type ComponentPropsWithoutRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkFrontmatter from "remark-frontmatter";
import { FrontmatterCard, extractFrontmatter } from "./FrontmatterCard";
import { MermaidDiagram } from "@/components/ui/MermaidDiagram.tsx";

// ── Code Block Router ──

function CodeBlock({ className, children, ...props }: ComponentPropsWithoutRef<"code">) {
  const match = /language-(\w+)/.exec(className || "");
  const lang = match?.[1];
  const code = String(children).replace(/\n$/, "");

  if (lang === "mermaid") {
    return <MermaidDiagram syntax={code} />;
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
  );
}
