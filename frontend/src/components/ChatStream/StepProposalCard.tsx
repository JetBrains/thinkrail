import { useState } from "react";
import { Button } from "../ui/Button";

interface StepProposalCardProps {
  ticketId: string;
  stepNumber: number;
  stepTitle: string;
  skill: string;
  inputSpecIds: string[];
  reason: string;
  answered: boolean;
  decision?: "approved" | "dismissed";
  dismissReason?: string;
  onApprove: () => void;
  onDismiss: (reason?: string) => void;
}

export default function StepProposalCard({
  ticketId,
  stepNumber,
  stepTitle,
  skill,
  inputSpecIds,
  reason,
  answered,
  decision,
  dismissReason,
  onApprove,
  onDismiss,
}: StepProposalCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [dismissing, setDismissing] = useState(false);
  const [dismissText, setDismissText] = useState("");

  const headerLabel = `Step Proposal · ${ticketId}`;
  const titleLabel = `Step ${stepNumber}: ${stepTitle}`;

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
          <span className="chat-suggestion-header">{headerLabel}</span>
          <span className="chat-suggestion-name">{titleLabel}</span>
          <span
            className={`chat-suggestion-status ${
              decision === "approved"
                ? "chat-suggestion-approved"
                : "chat-suggestion-dismissed"
            }`}
          >
            {decision === "approved" ? "✓ Step started" : "✕ Dismissed"}
          </span>
        </div>

        {expanded && (
          <div className="chat-suggestion-expanded">
            {skill && <span className="chat-suggestion-skill">{skill}</span>}
            {inputSpecIds.length > 0 && (
              <span className="chat-suggestion-specs">
                {inputSpecIds.join(", ")}
              </span>
            )}
            <div className="chat-suggestion-reason">{reason}</div>
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
      <div className="chat-suggestion-header">{headerLabel}</div>
      <div className="chat-suggestion-name">{titleLabel}</div>
      <div className="chat-suggestion-reason">{reason}</div>
      <div className="chat-suggestion-meta">
        {skill && <span className="chat-suggestion-skill">{skill}</span>}
        {inputSpecIds.length > 0 && (
          <span className="chat-suggestion-specs">{inputSpecIds.join(", ")}</span>
        )}
      </div>

      {dismissing ? (
        <div className="chat-suggestion-dismiss-form">
          <label className="chat-suggestion-dismiss-prompt">
            Why dismiss this step?
          </label>
          <textarea
            className="chat-suggestion-dismiss-input"
            rows={2}
            placeholder="Optional — tell the orchestrator why..."
            value={dismissText}
            onChange={(e) => setDismissText(e.target.value)}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
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
          <Button variant="approve" onClick={onApprove}>
            Start Step
          </Button>
          <Button variant="deny" onClick={() => setDismissing(true)}>
            Dismiss…
          </Button>
        </div>
      )}
    </div>
  );
}
