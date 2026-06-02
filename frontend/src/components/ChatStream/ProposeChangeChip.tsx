import { useMemo, useState } from "react";
import "./ProposeChangeChip.css";

export interface HunkSummary {
  requestId: string;
  state: "pending" | "accepted" | "rejected";
  section: string | null;
  added: number;
  removed: number;
}

interface Props {
  filePath: string;
  hunks: HunkSummary[];
  onAcceptAll: () => void;
  onRejectAll: () => void;
  onDiscuss: (text: string) => void;
  onReview: () => void;
}

export function ProposeChangeChip(props: Props) {
  const [discussOpen, setDiscussOpen] = useState(false);
  const [feedback, setFeedback] = useState("");

  const counts = useMemo(() => {
    let accepted = 0;
    let rejected = 0;
    let pending = 0;
    for (const h of props.hunks) {
      if (h.state === "accepted") accepted++;
      else if (h.state === "rejected") rejected++;
      else pending++;
    }
    return { accepted, rejected, pending };
  }, [props.hunks]);

  const total = props.hunks.length;
  const allResolved = counts.pending === 0;
  const singleHunk = total === 1 ? props.hunks[0] : null;
  const showProgress = counts.accepted + counts.rejected > 0;

  return (
    <div className="pcc">
      <div className="pcc__row">
        <span className="pcc__icon">📝</span>
        <span className="pcc__path">{props.filePath}</span>
        {singleHunk?.section ? (
          <span className="pcc__section">§ {singleHunk.section}</span>
        ) : (
          <span className="pcc__count">{total} changes</span>
        )}
      </div>
      {showProgress && (
        <div className="pcc__progress">
          {counts.accepted > 0 && (
            <div className="pcc__seg pcc__seg--accepted" style={{ flex: counts.accepted }} />
          )}
          {counts.rejected > 0 && (
            <div className="pcc__seg pcc__seg--rejected" style={{ flex: counts.rejected }} />
          )}
          {counts.pending > 0 && (
            <div className="pcc__seg pcc__seg--pending" style={{ flex: counts.pending }} />
          )}
        </div>
      )}
      <div className="pcc__counts">
        {counts.accepted > 0 && <span className="pcc__accepted">✓ {counts.accepted} accepted</span>}
        {counts.rejected > 0 && <span className="pcc__rejected">✕ {counts.rejected} rejected</span>}
        {counts.pending > 0 && <span className="pcc__pending">● {counts.pending} pending</span>}
      </div>
      <div className="pcc__actions">
        {!allResolved && (
          <>
            <button className="pcc__btn pcc__btn--primary" onClick={props.onAcceptAll}>
              Accept all ({counts.pending})
            </button>
            <button className="pcc__btn" onClick={() => setDiscussOpen((v) => !v)}>
              Discuss
            </button>
            <button className="pcc__btn pcc__btn--danger" onClick={props.onRejectAll}>
              Reject all
            </button>
          </>
        )}
        <button className="pcc__btn pcc__btn--review" onClick={props.onReview}>
          Review →
        </button>
      </div>
      {discussOpen && !allResolved && (
        <div className="pcc__discuss">
          <textarea
            data-testid="chip-discuss-textarea"
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="Feedback attached to every still-pending hunk…"
            rows={3}
          />
          <div className="pcc__discuss-actions">
            <button
              className="pcc__btn pcc__btn--primary"
              onClick={() => {
                props.onDiscuss(feedback);
                setDiscussOpen(false);
                setFeedback("");
              }}
            >
              Send
            </button>
            <button
              className="pcc__btn"
              onClick={() => {
                setDiscussOpen(false);
                setFeedback("");
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
