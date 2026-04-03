import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { PromptSection } from "@/types/session.ts";
import "./PromptPreview.css";

interface PromptPreviewProps {
  systemPrompt: string;
  sections: PromptSection[] | null | undefined;
}

const SECTION_COLORS: Record<string, string> = {
  general: "#6B57FF",
  task: "#087CFA",
  project: "#21D789",
  specs: "#E8A336",
};

function SectionContent({ content }: { content: string }) {
  return (
    <div className="prompt-section-content">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  );
}

export function PromptPreview({ systemPrompt, sections }: PromptPreviewProps) {
  const [expanded, setExpanded] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const [expandedSpecs, setExpandedSpecs] = useState<Set<string>>(new Set());

  const totalTokens = sections
    ? sections.reduce((sum, s) => sum + s.tokens, 0)
    : Math.ceil((systemPrompt?.length ?? 0) / 4);

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
                    <span className="prompt-section-tokens">{s.tokens.toLocaleString()} tok</span>
                  </div>
                  {isOpen && s.key !== "specs" && (
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
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Fallback: flat prompt when no structured sections */}
      {expanded && (!sections || sections.length === 0) && systemPrompt && (
        <div className="prompt-section-content prompt-section-content--fallback">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{systemPrompt}</ReactMarkdown>
        </div>
      )}
    </div>
  );
}
