import { useState, lazy, Suspense, type KeyboardEvent } from "react";
import { useMonacoTheme } from "@/components/MarkdownEditor/useMonacoTheme.ts";
import { useFontSize } from "@/utils/fontScale.ts";
import "./FrontmatterCard.css";

const Editor = lazy(() => import("@monaco-editor/react"));

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---/;

/**
 * Extract YAML frontmatter from a markdown string.
 * Returns the YAML text (without `---` delimiters) or null if none found.
 */
export function extractFrontmatter(content: string): string | null {
  const m = FM_RE.exec(content);
  if (!m) return null;
  const yaml = m[1].trim();
  return yaml || null;
}

/**
 * Collapsible card that renders YAML frontmatter with syntax highlighting
 * via a read-only Monaco Editor.
 *
 * The `value` prop contains the raw YAML text (without `---` delimiters).
 */
export function FrontmatterCard({ value }: { value?: string }) {
  const [expanded, setExpanded] = useState(false);
  const monacoTheme = useMonacoTheme();
  const editorFontSize = useFontSize("md");

  // Don't render the card for empty frontmatter
  if (!value || !value.trim()) return null;

  const lineCount = value.split("\n").length;
  const editorHeight = Math.min(Math.max(lineCount * 19, 40), 200);

  const toggle = () => setExpanded((prev) => !prev);

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggle();
    }
  };

  return (
    <div className="fm-card">
      <div
        className="fm-card-header"
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        onClick={toggle}
        onKeyDown={handleKeyDown}
      >
        <span className="fm-card-toggle">{expanded ? "\u25BE" : "\u25B8"}</span>
        <span className="fm-card-label">Frontmatter</span>
      </div>
      {expanded && (
        <div className="fm-card-body" style={{ height: editorHeight }}>
          <Suspense
            fallback={
              <pre className="fm-card-fallback">
                <code>{value}</code>
              </pre>
            }
          >
            <Editor
              value={value}
              language="yaml"
              theme={monacoTheme}
              height={editorHeight}
              options={{
                readOnly: true,
                minimap: { enabled: false },
                lineNumbers: "off",
                scrollBeyondLastLine: false,
                wordWrap: "on",
                automaticLayout: true,
                folding: false,
                fontSize: editorFontSize,
                fontFamily:
                  "'JetBrains Mono', 'Fira Code', 'SF Mono', Menlo, Consolas, monospace",
                renderLineHighlight: "none",
                overviewRulerLanes: 0,
                hideCursorInOverviewRuler: true,
                scrollbar: { vertical: "auto", horizontal: "auto" },
                padding: { top: 6, bottom: 6 },
                domReadOnly: true,
              }}
            />
          </Suspense>
        </div>
      )}
    </div>
  );
}
