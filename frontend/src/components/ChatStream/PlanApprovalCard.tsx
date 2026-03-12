import { useState } from "react";
import { ChatMarkdown } from "./ChatMarkdown.tsx";

interface AllowedPrompt {
  tool: "Bash";
  prompt: string;
}

interface PlanApprovalCardProps {
  planContent?: string;
  allowedPrompts?: AllowedPrompt[];
  answered: boolean;
  decision?: "approve" | "deny";
  onApprove: () => void;
  onDeny: () => void;
}

/** Extract a short title from plan markdown: first heading or first line. */
export function extractPlanTitle(planContent?: string): string {
  if (!planContent) return "Plan";
  const match = planContent.match(/^#+\s+(.+)/m);
  if (match) return match[1].trim();
  const firstLine = planContent.trim().split("\n")[0]?.trim();
  return firstLine || "Plan";
}

export function PlanApprovalCard({
  planContent,
  allowedPrompts,
  answered,
  decision,
  onApprove,
  onDeny,
}: PlanApprovalCardProps) {
  const [expanded, setExpanded] = useState(false);
  const title = extractPlanTitle(planContent);
  const hasPrompts = allowedPrompts && allowedPrompts.length > 0;

  /* ── Answered: compact single row, click to expand ── */
  if (answered) {
    const stateClass =
      decision === "approve"
        ? "chat-plan-approval--approved"
        : "chat-plan-approval--denied";

    return (
      <div className={`chat-plan-approval chat-plan-approval-answered ${stateClass}`}>
        <div
          className="chat-plan-approval-row"
          onClick={() => setExpanded((v) => !v)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") setExpanded((v) => !v);
          }}
        >
          <span className="chat-plan-approval-label">Plan Review</span>
          <span className="chat-plan-approval-title">{title}</span>
          <span
            className={`chat-plan-approval-status ${
              decision === "approve"
                ? "chat-plan-approval-approved"
                : "chat-plan-approval-denied"
            }`}
          >
            {decision === "approve" ? "\u2713 Approved" : "\u2715 Rejected"}
          </span>
        </div>

        {expanded && (
          <div className="chat-plan-approval-expanded">
            {planContent && (
              <div className="chat-plan-approval-body">
                <ChatMarkdown content={planContent} />
              </div>
            )}
            {hasPrompts && (
              <div className="chat-plan-approval-tags">
                {allowedPrompts!.map((p, i) => (
                  <span key={i} className="chat-plan-approval-tag">
                    {p.prompt}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  /* ── Pending: full card with plan body + approve/reject buttons ── */
  return (
    <div className="chat-plan-approval">
      <div className="chat-plan-approval-header">Plan Ready for Review</div>

      {planContent && (
        <div className="chat-plan-approval-body">
          <ChatMarkdown content={planContent} />
        </div>
      )}

      {hasPrompts && (
        <div className="chat-plan-approval-tags">
          <span className="chat-plan-approval-tags-label">Requested permissions:</span>
          {allowedPrompts!.map((p, i) => (
            <span key={i} className="chat-plan-approval-tag">
              {p.prompt}
            </span>
          ))}
        </div>
      )}

      <div className="chat-plan-approval-actions">
        <button className="chat-btn chat-btn-approve" onClick={onApprove}>
          Approve Plan
        </button>
        <button className="chat-btn chat-btn-deny" onClick={onDeny}>
          Reject Plan
        </button>
      </div>
    </div>
  );
}
