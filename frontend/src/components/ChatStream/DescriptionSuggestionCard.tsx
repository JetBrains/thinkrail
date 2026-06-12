import { useState } from "react";
import { Button } from "../ui/Button";

interface DescriptionSuggestionCardProps {
  description: string;
  section?: string;
  answered: boolean;
  decision?: "applied" | "dismissed";
  dismissReason?: string;
  onApply: () => void;
  onDismiss: (reason?: string) => void;
}

export default function DescriptionSuggestionCard({
  description,
  section,
  answered,
  decision,
  dismissReason,
  onApply,
  onDismiss,
}: DescriptionSuggestionCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [dismissing, setDismissing] = useState(false);
  const [dismissText, setDismissText] = useState("");

  const sectionLabel = section && section !== "full" ? ` (${section})` : "";

  if (answered) {
    const stateClass =
      decision === "applied"
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
          <span className="chat-suggestion-header">Description Suggestion{sectionLabel}</span>
          <span
            className={`chat-suggestion-status ${
              decision === "applied"
                ? "chat-suggestion-approved"
                : "chat-suggestion-dismissed"
            }`}
          >
            {decision === "applied" ? "\u2713 Applied" : "\u2715 Dismissed"}
          </span>
        </div>

        {expanded && (
          <div className="chat-suggestion-expanded">
            <pre className="chat-suggestion-prompt-content">{description}</pre>
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
      <div className="chat-suggestion-header">Description Suggestion{sectionLabel}</div>
      <pre className="chat-suggestion-prompt-content">{description}</pre>

      {dismissing ? (
        <div className="chat-suggestion-dismiss-form">
          <label className="chat-suggestion-dismiss-prompt">
            Why dismiss this suggestion?
          </label>
          <textarea
            className="chat-suggestion-dismiss-input"
            rows={2}
            placeholder="Optional — tell the agent what to change..."
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
            <Button
              variant="deny"
              onClick={() => onDismiss(dismissText.trim() || undefined)}
            >
              Dismiss
            </Button>
            <Button
              variant="muted"
              onClick={() => { setDismissing(false); setDismissText(""); }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="chat-suggestion-actions">
          <Button variant="approve" onClick={onApply}>
            Apply to description
          </Button>
          <Button variant="deny" onClick={() => setDismissing(true)}>
            Dismiss...
          </Button>
        </div>
      )}
    </div>
  );
}
