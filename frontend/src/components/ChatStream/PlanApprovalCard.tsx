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
  interrupted?: boolean;
  rejectionReason?: string;
  onApprove: () => void;
  onDeny: (reason?: string) => void;
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
  interrupted,
  rejectionReason,
  onApprove,
  onDeny,
}: PlanApprovalCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
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
            {interrupted ? "\u2718 Interrupted" : decision === "approve" ? "\u2713 Approved" : "\u2715 Rejected"}
          </span>
        </div>

        {expanded && (
          <div className="chat-plan-approval-expanded">
            {planContent ? (
              <div className="chat-plan-approval-body">
                <ChatMarkdown content={planContent} />
              </div>
            ) : (
              <div className="chat-plan-approval-empty">
                Plan written to file
              </div>
            )}
            {rejectionReason && (
              <div className="chat-plan-approval-reason-display">
                <span className="chat-plan-approval-reason-label">Reason:</span>{" "}
                {rejectionReason}
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

      {planContent ? (
        <div className="chat-plan-approval-body">
          <ChatMarkdown content={planContent} />
        </div>
      ) : (
        <div className="chat-plan-approval-empty">
          Plan written to file — approve to continue
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

      {rejecting ? (
        <div className="chat-plan-approval-reason">
          <label className="chat-plan-approval-reason-prompt">
            Why are you rejecting this plan?
          </label>
          <textarea
            className="chat-plan-approval-reason-input"
            rows={3}
            placeholder="Describe what should change..."
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                onDeny(reason.trim() || undefined);
              }
            }}
          />
          <div className="chat-plan-approval-reason-actions">
            <button
              className="chat-btn chat-btn-deny"
              onClick={() => onDeny(reason.trim() || undefined)}
            >
              Submit Rejection
            </button>
            <button
              className="chat-btn chat-btn-muted"
              onClick={() => { setRejecting(false); setReason(""); }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="chat-plan-approval-actions">
          <button className="chat-btn chat-btn-approve" onClick={onApprove}>
            Approve Plan
          </button>
          <button className="chat-btn chat-btn-deny" onClick={() => setRejecting(true)}>
            Reject Plan
          </button>
        </div>
      )}
    </div>
  );
}
