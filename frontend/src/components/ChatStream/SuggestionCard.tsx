import { useState } from "react";

interface SuggestionCardProps {
  skill: string;
  specIds: string[];
  name: string;
  reason: string;
  prompt?: string;
  answered: boolean;
  decision?: "approved" | "dismissed";
  dismissReason?: string;
  onApprove: () => void;
  onDismiss: (reason?: string) => void;
}

export default function SuggestionCard({
  skill,
  specIds,
  name,
  reason,
  prompt,
  answered,
  decision,
  dismissReason,
  onApprove,
  onDismiss,
}: SuggestionCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [promptExpanded, setPromptExpanded] = useState(false);
  const [dismissing, setDismissing] = useState(false);
  const [dismissText, setDismissText] = useState("");

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
            {skill && <span className="chat-suggestion-skill">{skill}</span>}
            {specIds.length > 0 && (
              <span className="chat-suggestion-specs">
                {specIds.join(", ")}
              </span>
            )}
            <div className="chat-suggestion-reason">{reason}</div>
            {prompt && (
              <pre className="chat-suggestion-prompt-content">{prompt}</pre>
            )}
            {dismissReason && (
              <div className="chat-suggestion-dismiss-reason">
                <span className="chat-suggestion-dismiss-reason-label">Reason:</span>{" "}
                {dismissReason}
              </div>
            )}
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
        {skill && <span className="chat-suggestion-skill">{skill}</span>}
        {specIds.length > 0 && (
          <span className="chat-suggestion-specs">{specIds.join(", ")}</span>
        )}
      </div>

      {prompt && (
        <div className="chat-suggestion-prompt-section">
          <button
            className="chat-suggestion-prompt-toggle"
            onClick={() => setPromptExpanded((v) => !v)}
          >
            {promptExpanded ? "▾" : "▸"} Instructions
          </button>
          {promptExpanded && (
            <pre className="chat-suggestion-prompt-content">{prompt}</pre>
          )}
        </div>
      )}

      {dismissing ? (
        <div className="chat-suggestion-dismiss-form">
          <label className="chat-suggestion-dismiss-prompt">
            Why dismiss this suggestion?
          </label>
          <textarea
            className="chat-suggestion-dismiss-input"
            rows={2}
            placeholder="Optional — tell the agent why..."
            value={dismissText}
            onChange={(e) => setDismissText(e.target.value)}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                onDismiss(dismissText.trim() || undefined);
              }
              if (e.key === "Escape") {
                setDismissing(false);
                setDismissText("");
              }
            }}
          />
          <div className="chat-suggestion-actions">
            <button
              className="chat-btn chat-btn-deny"
              onClick={() => onDismiss(dismissText.trim() || undefined)}
            >
              Dismiss
            </button>
            <button
              className="chat-btn chat-btn-muted"
              onClick={() => { setDismissing(false); setDismissText(""); }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="chat-suggestion-actions">
          <button className="chat-btn chat-btn-approve" onClick={onApprove}>
            Start Session
          </button>
          <button className="chat-btn chat-btn-deny" onClick={() => setDismissing(true)}>
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}
