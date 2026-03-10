import { useState } from "react";

interface ApprovalCardProps {
  toolName: string;
  toolInput?: unknown;
  description?: string;
  answered: boolean;
  decision?: "approve" | "deny";
  onApprove: () => void;
  onDeny: () => void;
}

function formatToolInput(input: unknown): string {
  if (!input) return "";
  if (typeof input === "string") return input;
  if (typeof input === "object") {
    const obj = input as Record<string, unknown>;
    // Show the most relevant field for common tools
    if (obj.command) return String(obj.command);
    if (obj.file_path) return String(obj.file_path);
    if (obj.path) return String(obj.path);
    if (obj.pattern) return String(obj.pattern);
    return JSON.stringify(input, null, 2);
  }
  return String(input);
}

function truncate(text: string, maxLen = 60): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + "\u2026";
}

export function ApprovalCard({
  toolName,
  toolInput,
  description,
  answered,
  decision,
  onApprove,
  onDeny,
}: ApprovalCardProps) {
  const [expanded, setExpanded] = useState(false);
  const fullInput = toolInput != null ? formatToolInput(toolInput) : "";

  /* ── Answered: compact single-line, click to expand ── */
  if (answered) {
    const stateClass =
      decision === "approve" ? "chat-approval--approved" : "chat-approval--denied";

    return (
      <div className={`chat-approval chat-approval-compact ${stateClass}`}>
        <div
          className="chat-approval-row"
          onClick={() => setExpanded((v) => !v)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") setExpanded((v) => !v);
          }}
        >
          <span className="chat-approval-label">Action requires approval</span>
          <span className="chat-approval-command">
            <span className="chat-tool-name">{toolName}</span>
            {fullInput && (
              <span className="chat-approval-input-short">
                {truncate(fullInput)}
              </span>
            )}
          </span>
          <span
            className={`chat-approval-status ${
              decision === "approve"
                ? "chat-approval-approved"
                : "chat-approval-denied"
            }`}
          >
            {decision === "approve" ? "\u2713 Approved" : "\u2715 Denied"}
          </span>
        </div>

        {expanded && (
          <div className="chat-approval-expanded">
            {fullInput && (
              <pre className="chat-approval-full-command">{fullInput}</pre>
            )}
            {description && (
              <div className="chat-approval-desc">{description}</div>
            )}
          </div>
        )}
      </div>
    );
  }

  /* ── Pending: full card with approve / deny buttons ── */
  return (
    <div className="chat-approval">
      <div className="chat-approval-title">Action requires approval</div>
      <div className="chat-approval-tool">
        <span className="chat-tool-name">{toolName}</span>
        {toolInput != null && (
          <span className="chat-approval-input">{fullInput}</span>
        )}
      </div>
      {description && <div className="chat-approval-desc">{description}</div>}
      <div className="chat-approval-actions">
        <button className="chat-btn chat-btn-approve" onClick={onApprove}>
          Approve
        </button>
        <button className="chat-btn chat-btn-deny" onClick={onDeny}>
          Deny
        </button>
      </div>
    </div>
  );
}
