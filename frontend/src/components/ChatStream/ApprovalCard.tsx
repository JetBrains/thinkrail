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

export function ApprovalCard({
  toolName,
  toolInput,
  description,
  answered,
  decision,
  onApprove,
  onDeny,
}: ApprovalCardProps) {
  return (
    <div className={`chat-approval ${answered ? "chat-approval-answered" : ""}`}>
      <div className="chat-approval-title">Action requires approval</div>
      <div className="chat-approval-tool">
        <span className="chat-tool-name">{toolName}</span>
        {toolInput != null && <span className="chat-approval-input">{formatToolInput(toolInput)}</span>}
      </div>
      {description && (
        <div className="chat-approval-desc">{description}</div>
      )}
      {answered ? (
        <div
          className={`chat-approval-result ${decision === "approve" ? "chat-approval-approved" : "chat-approval-denied"}`}
        >
          {decision === "approve" ? "\u2713 Approved" : "\u2715 Denied"}
        </div>
      ) : (
        <div className="chat-approval-actions">
          <button className="chat-btn chat-btn-approve" onClick={onApprove}>
            Approve
          </button>
          <button className="chat-btn chat-btn-deny" onClick={onDeny}>
            Deny
          </button>
        </div>
      )}
    </div>
  );
}
