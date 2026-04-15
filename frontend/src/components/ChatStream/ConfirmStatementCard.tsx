import { useCallback, useEffect, useRef, useState } from "react";

interface ConfirmStatementCardProps {
  statement: string;
  answered: boolean;
  interrupted?: boolean;
  approvedStatement?: string;
  onApprove: (statement: string) => void;
}

export function ConfirmStatementCard({
  statement,
  answered,
  interrupted,
  approvedStatement,
  onApprove,
}: ConfirmStatementCardProps) {
  const [text, setText] = useState(statement);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!answered) textareaRef.current?.focus();
  }, [answered]);

  const handleApprove = useCallback(() => {
    onApprove(text.trim() || statement);
  }, [text, statement, onApprove]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleApprove();
      }
    },
    [handleApprove],
  );

  if (answered) {
    return (
      <div className="chat-statement chat-statement--answered">
        <div className="chat-statement-header-row">
          <span className="chat-statement-label">Statement confirmed</span>
          <span className={`chat-statement-done${interrupted ? " chat-statement-interrupted" : ""}`}>
            {interrupted ? "\u2718 interrupted" : "\u2713 done"}
          </span>
        </div>
        {!interrupted && approvedStatement && (
          <div className="chat-statement-approved-text">{approvedStatement}</div>
        )}
      </div>
    );
  }

  return (
    <div className="chat-statement">
      <div className="chat-statement-label">Confirm statement</div>
      <textarea
        ref={textareaRef}
        className="chat-statement-textarea"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        rows={4}
      />
      <div className="chat-statement-footer">
        <span className="chat-statement-hint">Edit if needed, then approve</span>
        <button className="chat-btn chat-btn-primary" onClick={handleApprove}>
          Approve
        </button>
      </div>
    </div>
  );
}
