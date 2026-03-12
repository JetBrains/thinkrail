import { useState } from "react";

interface SuggestionCardProps {
  skill: string;
  specIds: string[];
  name: string;
  reason: string;
  answered: boolean;
  decision?: "approved" | "dismissed";
  onApprove: () => void;
  onDismiss: () => void;
}

export default function SuggestionCard({
  skill,
  specIds,
  name,
  reason,
  answered,
  decision,
  onApprove,
  onDismiss,
}: SuggestionCardProps) {
  const [expanded, setExpanded] = useState(false);

  if (answered) {
    const stateClass =
      decision === "approved"
        ? "chat-suggestion--approved"
        : "chat-suggestion--dismissed";

    return (
      <div className={`chat-suggestion chat-suggestion-answered ${stateClass}`}>
        <div
          className="chat-suggestion-row"
          onClick={() => setExpanded((v) => !v)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") setExpanded((v) => !v);
          }}
        >
          <span className="chat-suggestion-header">Session Suggestion</span>
          <span className="chat-suggestion-name">{name}</span>
          <span
            className={`chat-suggestion-status ${
              decision === "approved"
                ? "chat-suggestion-approved"
                : "chat-suggestion-dismissed"
            }`}
          >
            {decision === "approved" ? "\u2713 Session started" : "\u2715 Dismissed"}
          </span>
        </div>

        {expanded && (
          <div className="chat-suggestion-expanded">
            <span className="chat-suggestion-skill">{skill}</span>
            {specIds.length > 0 && (
              <span className="chat-suggestion-specs">
                {specIds.join(", ")}
              </span>
            )}
            <div className="chat-suggestion-reason">{reason}</div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="chat-suggestion">
      <div className="chat-suggestion-header">Session Suggestion</div>
      <div className="chat-suggestion-name">{name}</div>
      <div className="chat-suggestion-reason">{reason}</div>
      <div className="chat-suggestion-meta">
        <span className="chat-suggestion-skill">{skill}</span>
        {specIds.length > 0 && (
          <span className="chat-suggestion-specs">{specIds.join(", ")}</span>
        )}
      </div>
      <div className="chat-suggestion-actions">
        <button className="chat-btn chat-btn-approve" onClick={onApprove}>
          Start Session
        </button>
        <button className="chat-btn chat-btn-deny" onClick={onDismiss}>
          Dismiss
        </button>
      </div>
    </div>
  );
}
