interface ApprovalCardProps {
  toolName: string;
  toolInput?: string;
  description?: string;
  answered: boolean;
  decision?: "approve" | "deny";
  onApprove: () => void;
  onDeny: () => void;
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
        {toolInput && <span className="chat-approval-input">{toolInput}</span>}
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
