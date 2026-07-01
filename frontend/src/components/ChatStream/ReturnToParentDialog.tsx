import { useEffect, useState } from "react";
import { Button } from "../ui/Button";

interface ReturnToParentDialogProps {
  open: boolean;
  parentName: string;
  /** Where a "with result" return will land in the parent. */
  targetKind: "question" | "message";
  /** Agent-drafted summary; may arrive after the dialog opens (see `drafting`). */
  draftSummary: string;
  /** True while the agent is still drafting the summary. */
  drafting: boolean;
  onRegenerate: () => void;
  onReturnWith: (text: string) => void;
  onReturnWithout: () => void;
  onCancel: () => void;
}

export function ReturnToParentDialog({
  open,
  parentName,
  targetKind,
  draftSummary,
  drafting,
  onRegenerate,
  onReturnWith,
  onReturnWithout,
  onCancel,
}: ReturnToParentDialogProps) {
  const [editText, setEditText] = useState(draftSummary);

  // Sync in the agent's draft when it arrives / is regenerated.
  useEffect(() => {
    setEditText(draftSummary);
  }, [draftSummary]);

  if (!open) return null;

  const targetLabel =
    targetKind === "question"
      ? "the “Other” field of the question you were answering"
      : "your message box in the parent session";

  const canReturnWith = !drafting && editText.trim().length > 0;

  return (
    <div className="return-dialog-overlay" onClick={onCancel}>
      <div
        className="return-dialog"
        role="dialog"
        aria-label="Return to parent session"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="return-dialog-head">
          <span className="return-dialog-icon" aria-hidden="true">{"💬"}</span>
          <span className="return-dialog-title">Return to parent session</span>
          <span className="return-dialog-spacer" />
          <button className="return-dialog-x" onClick={onCancel} aria-label="Cancel">
            {"×"}
          </button>
        </div>

        <div className="return-dialog-body">
          <div className="return-dialog-sub">
            Bring this discussion&rsquo;s conclusion back to &ldquo;{parentName}&rdquo;.
          </div>
          <div className="return-dialog-target">
            Lands in: <span className="return-dialog-target-key">{targetLabel}</span>
          </div>

          <div className="return-dialog-sumhead">
            <span className="return-dialog-sumlabel">Suggested summary</span>
            <span className="return-dialog-spacer" />
            <button
              className="return-dialog-regen"
              onClick={onRegenerate}
              disabled={drafting}
            >
              {"↻"} Regenerate
            </button>
          </div>

          <textarea
            className="return-dialog-summary"
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            rows={6}
            placeholder={drafting ? "Drafting a summary…" : "Write the summary to return…"}
            disabled={drafting}
          />
          <div className="return-dialog-hint">
            {drafting
              ? "The agent is drafting this from the discussion…"
              : "Edit freely — you approve exactly what goes back."}
          </div>
        </div>

        <div className="return-dialog-foot">
          <Button variant="muted" onClick={onReturnWithout}>
            Return without a result
          </Button>
          <span className="return-dialog-spacer" />
          <Button onClick={onCancel}>Cancel</Button>
          <Button
            variant="approve"
            onClick={() => onReturnWith(editText)}
            disabled={!canReturnWith}
          >
            Return with result {"▸"}
          </Button>
        </div>
      </div>
    </div>
  );
}
