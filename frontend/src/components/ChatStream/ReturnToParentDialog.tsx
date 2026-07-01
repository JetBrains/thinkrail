import { useEffect, useRef, useState } from "react";
import { Button } from "../ui/Button";

interface ReturnToParentDialogProps {
  open: boolean;
  parentName: string;
  /** Where a "with result" return will land in the parent. */
  targetKind: "question" | "message";
  /** Agent-drafted summary; may arrive after the dialog opens (see `drafting`). */
  draftSummary: string;
  /** Instant fallback shown until the draft arrives — the discussion's last
   *  assistant message — so the box is never empty/blocking. */
  fallbackSummary: string;
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
  fallbackSummary,
  drafting,
  onRegenerate,
  onReturnWith,
  onReturnWithout,
  onCancel,
}: ReturnToParentDialogProps) {
  const [editText, setEditText] = useState(draftSummary || fallbackSummary);
  const touched = useRef(false);

  // Until the user edits, mirror the best available text: the agent's draft
  // once it arrives, otherwise the last-message fallback.
  useEffect(() => {
    if (touched.current) return;
    setEditText(draftSummary || fallbackSummary);
  }, [draftSummary, fallbackSummary]);

  // Fresh start each time the dialog reopens.
  useEffect(() => {
    if (open) touched.current = false;
  }, [open]);

  if (!open) return null;

  const targetLabel =
    targetKind === "question"
      ? "the “Other” field of the question you were answering"
      : "your message box in the parent session";

  const canReturnWith = editText.trim().length > 0;

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
            onChange={(e) => {
              touched.current = true;
              setEditText(e.target.value);
            }}
            rows={6}
            placeholder="Write the summary to return…"
          />
          <div className="return-dialog-hint">
            {drafting
              ? "Showing the last message — the agent is drafting a fuller summary…"
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
