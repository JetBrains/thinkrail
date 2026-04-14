import { useCallback, useState } from "react";

interface ReturnFlowCardProps {
  bonsaiSid: string;
  subsessionType: "discussion" | "refinement";
  proposedSummary: string;
  onApprove: (text: string) => void;
  onDismiss: () => void;
  onRevise: (feedback: string) => void;
  onPutInInput?: (text: string) => void;
  onSendAsMessage?: (text: string) => void;
}

export function ReturnFlowCard({
  bonsaiSid,
  subsessionType,
  proposedSummary,
  onApprove,
  onDismiss,
  onRevise,
  onPutInInput,
  onSendAsMessage,
}: ReturnFlowCardProps) {
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(proposedSummary);
  const [revising, setRevising] = useState(false);
  const [feedback, setFeedback] = useState("");

  const displayText = editing ? editText : proposedSummary;
  const isRefinement = subsessionType === "refinement";

  const handleApprove = useCallback(() => {
    onApprove(editing ? editText : proposedSummary);
  }, [editing, editText, proposedSummary, onApprove]);

  const handleRevise = useCallback(() => {
    if (feedback.trim()) {
      onRevise(feedback.trim());
      setFeedback("");
      setRevising(false);
    }
  }, [feedback, onRevise]);

  return (
    <div className="return-flow-card" data-bonsai-sid={bonsaiSid}>
      <div className="return-flow-header">
        <span className="return-flow-icon">{isRefinement ? "\u270f\ufe0f" : "\ud83d\udccb"}</span>
        <span className="return-flow-title">
          {isRefinement ? "Refined content" : "Summary for parent session"}
        </span>
        <span className="return-flow-badge">{subsessionType}</span>
      </div>

      {editing ? (
        <textarea
          className="return-flow-editor"
          value={editText}
          onChange={(e) => setEditText(e.target.value)}
          rows={6}
        />
      ) : (
        <div className="return-flow-text">{displayText}</div>
      )}

      {revising ? (
        <div className="return-flow-revise">
          <textarea
            className="return-flow-feedback"
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="What should be changed?"
            rows={3}
          />
          <div className="return-flow-revise-actions">
            <button className="chat-btn chat-btn-primary" onClick={handleRevise} disabled={!feedback.trim()}>
              Send feedback
            </button>
            <button className="chat-btn" onClick={() => setRevising(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <div className="return-flow-actions">
          {isRefinement ? (
            <>
              <button className="chat-btn chat-btn-primary" onClick={() => onPutInInput?.(displayText)}>
                Put in input box
              </button>
              <button className="chat-btn chat-btn-primary" onClick={() => onSendAsMessage?.(displayText)}>
                Send as message
              </button>
            </>
          ) : (
            <button className="chat-btn chat-btn-approve" onClick={handleApprove}>
              Approve &amp; return
            </button>
          )}
          <button className="chat-btn" onClick={() => setEditing(!editing)}>
            {editing ? "Preview" : "Edit"}
          </button>
          <button className="chat-btn" onClick={() => setRevising(true)}>Revise</button>
          <button className="chat-btn chat-btn-muted" onClick={onDismiss}>Dismiss</button>
        </div>
      )}
    </div>
  );
}
