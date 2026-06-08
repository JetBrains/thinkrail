import { useState, lazy, Suspense } from "react";
import { getFileRawUrl } from "@/services/files.ts";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkFrontmatter from "remark-frontmatter";
import type { PromptSection } from "@/types/session.ts";
import { FrontmatterCard, extractFrontmatter } from "@/components/FileViewer/FrontmatterCard";
import { detectLanguage } from "@/components/FileViewer/languageMap.ts";
import { useMonacoTheme } from "@/components/MarkdownEditor/useMonacoTheme.ts";
import { useFontSize } from "@/utils/fontScale.ts";
import { useUiStore } from "@/store/uiStore.ts";
import "./PromptPreview.css";

const Editor = lazy(() => import("@monaco-editor/react"));

interface PromptPreviewProps {
  systemPrompt: string;
  sections: PromptSection[] | null | undefined;
  /** Draft has not been persisted yet, so there is no assembled prompt.
   *  Render a hint that the preview appears once the user types. */
  unsaved?: boolean;
}

const SECTION_COLORS: Record<string, string> = {
  general: "#6B57FF",
  task: "#087CFA",
  project: "#21D789",
  files: "#56B6C2",
  specs: "#E8A336",
};

const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "svg", "webp", "ico", "bmp"]);

function isImageFile(name: string): boolean {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return IMAGE_EXTS.has(ext);
}

function SectionContent({ content }: { content: string }) {
  const frontmatter = extractFrontmatter(content);
  return (
    <div className="prompt-section-content">
      <FrontmatterCard value={frontmatter ?? undefined} />
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkFrontmatter]}>
        {content}
      </ReactMarkdown>
    </div>
  );
}

function FilePreviewContent({ name, preview, path }: { name: string; preview: string; path: string }) {
  const monacoTheme = useMonacoTheme();
  const editorFontSize = useFontSize("md");
  const projectPath = useUiStore((s) => s.projectPath);

  if (isImageFile(name)) {
    const project = projectPath ?? "";
    return (
      <div className="prompt-file-preview prompt-file-preview--image">
        <img
          src={getFileRawUrl(project, path)}
          alt={name}
          className="prompt-file-image"
        />
      </div>
    );
  }

  if (!preview) {
    return <div className="prompt-file-preview prompt-file-preview--empty">No preview available</div>;
  }

  const lineCount = preview.split("\n").length;
  const height = Math.min(Math.max(lineCount * 19, 60), 300);

  return (
    <div className="prompt-file-preview" style={{ height }}>
      <Suspense fallback={<pre className="prompt-file-fallback">{preview}</pre>}>
        <Editor
          value={preview}
          language={detectLanguage(name)}
          theme={monacoTheme}
          height={height}
          options={{
            readOnly: true,
            minimap: { enabled: false },
            lineNumbers: "on",
            scrollBeyondLastLine: false,
            folding: false,
            fontSize: editorFontSize,
            renderLineHighlight: "none",
            overviewRulerLanes: 0,
            hideCursorInOverviewRuler: true,
            scrollbar: { vertical: "hidden", horizontal: "auto" },
          }}
        />
      </Suspense>
    </div>
  );
}

export function PromptPreview({ systemPrompt, sections, unsaved }: PromptPreviewProps) {
  const [expanded, setExpanded] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const [expandedSpecs, setExpandedSpecs] = useState<Set<string>>(new Set());

  if (unsaved) {
    return (
      <div className="prompt-preview prompt-preview--placeholder">
        <span className="prompt-preview-placeholder-text">
          System prompt preview appears once you start typing.
        </span>
      </div>
    );
  }

  const totalTokens = sections
    ? sections.reduce((sum, s) => sum + s.tokens, 0)
    : Math.ceil((systemPrompt?.length ?? 0) / 6);

  const toggleSection = (key: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const toggleSpec = (id: string) => {
    setExpandedSpecs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  return (
    <div className="prompt-preview">
      {/* Toggle header */}
      <button className="prompt-preview-toggle" onClick={() => setExpanded(!expanded)}>
        <span>{expanded ? "\u25BC" : "\u25B6"}</span>
        <span>System Prompt</span>
        <span className="prompt-preview-token-count">({totalTokens.toLocaleString()} est. tokens)</span>
      </button>

      {expanded && sections && sections.length > 0 && (
        <>
          {/* Stacked bar */}
          <div className="prompt-bar">
            {sections.map((s) => (
              <div
                key={s.key}
                className="prompt-bar-segment"
                style={{
                  flex: s.tokens,
                  background: SECTION_COLORS[s.key] ?? "var(--hint)",
                }}
                title={`${s.label}: ${s.tokens} tokens`}
              />
            ))}
          </div>

          {/* Legend */}
          <div className="prompt-legend">
            {sections.map((s) => (
              <span
                key={s.key}
                className="prompt-legend-item"
                style={{ background: `${SECTION_COLORS[s.key] ?? "var(--hint)"}20`, color: SECTION_COLORS[s.key] ?? "var(--hint)" }}
                onClick={() => toggleSection(s.key)}
              >
                {"\u25A0"} {s.label} ({s.tokens.toLocaleString()})
              </span>
            ))}
          </div>

          {/* Collapsible sections */}
          <div className="prompt-sections">
            {sections.map((s) => {
              const isOpen = expandedSections.has(s.key);
              const color = SECTION_COLORS[s.key] ?? "var(--hint)";
              return (
                <div key={s.key} className="prompt-section">
                  <div className="prompt-section-header" onClick={() => toggleSection(s.key)}>
                    <span className="prompt-section-bar" style={{ background: color }} />
                    <span style={{ color: isOpen ? color : "var(--hint)" }}>{isOpen ? "\u25BC" : "\u25B6"}</span>
                    <span className="prompt-section-label">{s.label}</span>
                    {s.key === "specs" && s.specDetails && (
                      <span className="prompt-section-count">({s.specDetails.length} files)</span>
                    )}
                    {s.key === "files" && s.fileDetails && (
                      <span className="prompt-section-count">({s.fileDetails.length} files)</span>
                    )}
                    <span className="prompt-section-tokens">{s.tokens.toLocaleString()} tok</span>
                  </div>
                  {isOpen && s.key !== "specs" && s.key !== "files" && (
                    <SectionContent content={s.content} />
                  )}
                  {isOpen && s.key === "specs" && s.specDetails && (
                    <div className="prompt-spec-list">
                      {s.specDetails.map((spec) => {
                        const specOpen = expandedSpecs.has(spec.id);
                        return (
                          <div key={spec.id} className="prompt-spec-entry">
                            <div className="prompt-spec-header" onClick={() => toggleSpec(spec.id)}>
                              <span style={{ color: specOpen ? "#E8A336" : "var(--hint)" }}>
                                {specOpen ? "\u25BC" : "\u25B6"}
                              </span>
                              <span>{spec.title}</span>
                              <span className="prompt-section-tokens">{spec.tokens.toLocaleString()} tok</span>
                            </div>
                            {specOpen && <SectionContent content={spec.content} />}
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {isOpen && s.key === "files" && s.fileDetails && (
                    <div className="prompt-spec-list">
                      {s.fileDetails.map((file) => {
                        const fileOpen = expandedSpecs.has(file.path);
                        return (
                          <div key={file.path} className="prompt-spec-entry">
                            <div className="prompt-spec-header" onClick={() => toggleSpec(file.path)}>
                              <span style={{ color: fileOpen ? "#56B6C2" : "var(--hint)" }}>
                                {fileOpen ? "\u25BC" : "\u25B6"}
                              </span>
                              <span>{file.name}</span>
                              <span className="prompt-section-tokens">{file.tokens.toLocaleString()} tok</span>
                            </div>
                            {fileOpen && <FilePreviewContent name={file.name} preview={file.preview} path={file.path} />}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Fallback: flat prompt when no structured sections */}
      {expanded && (!sections || sections.length === 0) && systemPrompt && (
        <div className="prompt-section-content prompt-section-content--fallback">
          <FrontmatterCard value={extractFrontmatter(systemPrompt) ?? undefined} />
          <ReactMarkdown remarkPlugins={[remarkGfm, remarkFrontmatter]}>
            {systemPrompt}
          </ReactMarkdown>
        </div>
      )}
    </div>
  );
}
