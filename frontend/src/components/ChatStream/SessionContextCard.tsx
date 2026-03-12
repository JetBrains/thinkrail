import { useState, useRef, useEffect } from "react";
import { SKILLS } from "@/constants/skills.ts";
import { useSpecStore } from "@/store/specStore.ts";

interface SessionContextCardProps {
  skillId?: string;
  specIds: string[];
  model: string;
  permissionMode: string;
  betas: string[];
  systemPrompt?: string;
  onVisibilityChange?: (visible: boolean) => void;
}

export function SessionContextCard({
  skillId,
  specIds,
  model,
  permissionMode,
  betas,
  systemPrompt,
  onVisibilityChange,
}: SessionContextCardProps) {
  const [promptExpanded, setPromptExpanded] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const specs = useSpecStore((s) => s.specs);

  // IntersectionObserver to track visibility
  useEffect(() => {
    if (!onVisibilityChange || !cardRef.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => onVisibilityChange(entry.isIntersecting),
      { threshold: 0.1 },
    );
    observer.observe(cardRef.current);
    return () => observer.disconnect();
  }, [onVisibilityChange]);

  const skill = skillId ? SKILLS.find((s) => s.id === skillId) : null;
  const specEntries = specIds
    .map((id) => specs.find((s) => s.id === id))
    .filter(Boolean);

  return (
    <div className="session-context-card" ref={cardRef}>
      {skill && (
        <div className="session-context-row">
          <span className="session-context-label">Skill</span>
          <span className="session-context-value">
            {skill.icon} {skill.name}
            <span className="session-context-desc"> &mdash; {skill.description}</span>
          </span>
        </div>
      )}

      {specEntries.length > 0 && (
        <div className="session-context-row">
          <span className="session-context-label">Specs</span>
          <span className="session-context-value">
            {specEntries.map((spec) => (
              <span key={spec!.id} className="session-context-pill">
                {spec!.title}
              </span>
            ))}
          </span>
        </div>
      )}

      <div className="session-context-row">
        <span className="session-context-label">Config</span>
        <span className="session-context-value">
          <span className="session-context-pill session-context-pill--model">
            {model}
          </span>
          <span className="session-context-pill">{permissionMode}</span>
          {betas.map((b) => (
            <span key={b} className="session-context-pill session-context-pill--beta">
              {b}
            </span>
          ))}
        </span>
      </div>

      {systemPrompt && (
        <div className="session-context-prompt">
          <button
            className="session-context-prompt-toggle"
            onClick={() => setPromptExpanded(!promptExpanded)}
          >
            {promptExpanded ? "\u25BC" : "\u25B6"} System Prompt
          </button>
          {promptExpanded && (
            <div className="session-context-prompt-body">
              <pre>{systemPrompt}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
