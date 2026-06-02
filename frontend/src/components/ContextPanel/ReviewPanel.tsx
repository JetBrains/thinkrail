import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Hunk, type ProposeChangeResponse, type HunkState } from "./Hunk.tsx";
import "./ReviewPanel.css";

export interface ReviewHunk {
  requestId: string;
  filePath: string;
  oldString: string;
  newString: string;
  section: string | null;
  rationale: string | null;
  validationWarnings: { kind: string; message: string }[];
  state: HunkState;
  resolution: Record<string, unknown> | null;
}

interface Props {
  filePath: string;
  content: string;
  hunks: ReviewHunk[];
  onResolve: (requestId: string, response: ProposeChangeResponse) => void;
  onAcceptAll: () => void;
  onRejectAll: () => void;
  onDiscuss: (text: string) => void;
  /** Optional. When provided, the header surfaces an exit affordance that
   *  drops the review mode and returns to the regular file/preview view. */
  onExit?: () => void;
}

export function ReviewPanel(props: Props) {
  const [focusedMode, setFocusedMode] = useState(true);
  const [renderMode, setRenderMode] = useState<"rendered" | "source">("rendered");
  const [discussOpen, setDiscussOpen] = useState(false);
  const [discussText, setDiscussText] = useState("");

  const isMarkdown = /\.(md|markdown)$/i.test(props.filePath);

  // Only pending hunks contribute to the review surface. Once accepted or
  // rejected, the file content already reflects the decision and a stale
  // hunk would lose its content anchor (oldString no longer present).
  const pendingHunks = useMemo(
    () => props.hunks.filter((h) => h.state === "pending"),
    [props.hunks],
  );
  const resolvedCount = props.hunks.length - pendingHunks.length;

  const stats = useMemo(() => {
    let added = 0;
    let removed = 0;
    for (const h of pendingHunks) {
      added += h.newString.split("\n").length;
      removed += h.oldString.split("\n").length;
    }
    return { added, removed, pending: pendingHunks.length };
  }, [pendingHunks]);

  // Focused mode lists pending hunks newest-first, no surrounding file
  // text. Full-file mode anchors hunks into the on-disk content using
  // their oldString position.
  const focusedHunks = useMemo(
    () => [...pendingHunks].reverse(),
    [pendingHunks],
  );
  const segments = useMemo(
    () => buildSegments(props.content, pendingHunks),
    [props.content, pendingHunks],
  );

  // Auto-exit review once every pending hunk has been resolved by the
  // user. Tracks the previous count so we only close on a real transition
  // (>0 → 0) — opening the panel with nothing pending shouldn't slam it
  // shut on mount.
  const onExit = props.onExit;
  const prevPendingRef = useRef(pendingHunks.length);
  useEffect(() => {
    if (prevPendingRef.current > 0 && pendingHunks.length === 0 && onExit) {
      onExit();
    }
    prevPendingRef.current = pendingHunks.length;
  }, [pendingHunks.length, onExit]);

  return (
    <div className="rp">
      <div className="rp__header">
        <span className="rp__path">{props.filePath}</span>
        <span className="rp__tag">review</span>
        {props.onExit && (
          <button
            className="rp__exit"
            title="Exit review (show normal preview)"
            onClick={props.onExit}
          >
            ×
          </button>
        )}
      </div>
      <div className="rp__toolbar">
        <div className="rp__seg">
          <button
            className={focusedMode ? "rp__seg-btn rp__seg-btn--on" : "rp__seg-btn"}
            onClick={() => setFocusedMode(true)}
          >
            Focused
          </button>
          <button
            className={!focusedMode ? "rp__seg-btn rp__seg-btn--on" : "rp__seg-btn"}
            onClick={() => setFocusedMode(false)}
          >
            Full file
          </button>
        </div>
        {isMarkdown && (
          <div className="rp__seg">
            <button
              className={renderMode === "rendered" ? "rp__seg-btn rp__seg-btn--on" : "rp__seg-btn"}
              onClick={() => setRenderMode("rendered")}
            >
              Rendered
            </button>
            <button
              className={renderMode === "source" ? "rp__seg-btn rp__seg-btn--on" : "rp__seg-btn"}
              onClick={() => setRenderMode("source")}
            >
              Source
            </button>
          </div>
        )}
        <span className="rp__spacer" />
        <span className="rp__stats">
          {stats.pending > 0 && <span className="rp__pending">{stats.pending} pending</span>}
          <span>+{stats.added} −{stats.removed}</span>
        </span>
      </div>

      <div className="rp__body">
        {resolvedCount > 0 && (
          <div className="rp__resolved-note">
            {resolvedCount} resolved hunk{resolvedCount !== 1 ? "s" : ""} hidden — applied to file
          </div>
        )}
        {focusedMode ? (
          pendingHunks.length === 0 ? (
            <div className="rp__collapsed">No pending changes.</div>
          ) : (
            focusedHunks.map((h, i) => (
              <Hunk
                key={h.requestId}
                requestId={h.requestId}
                index={pendingHunks.length - i}
                oldString={h.oldString}
                newString={h.newString}
                language={isMarkdown ? "markdown" : "plaintext"}
                rationale={h.rationale}
                section={h.section}
                validationWarnings={h.validationWarnings}
                state={h.state}
                resolution={h.resolution}
                renderMarkdown={isMarkdown && renderMode === "rendered"}
                onResolve={(resp) => props.onResolve(h.requestId, resp)}
              />
            ))
          )
        ) : (
          segments.map((seg, i) => {
            if (seg.kind === "text") {
              if (isMarkdown && renderMode === "rendered") {
                return (
                  <div key={i} className="rp__doc">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{seg.text}</ReactMarkdown>
                  </div>
                );
              }
              return (
                <pre key={i} className="rp__source">
                  {seg.text}
                </pre>
              );
            }
            return (
              <Hunk
                key={seg.hunk.requestId}
                requestId={seg.hunk.requestId}
                index={seg.index}
                oldString={seg.hunk.oldString}
                newString={seg.hunk.newString}
                language={isMarkdown ? "markdown" : "plaintext"}
                rationale={seg.hunk.rationale}
                section={seg.hunk.section}
                validationWarnings={seg.hunk.validationWarnings}
                state={seg.hunk.state}
                resolution={seg.hunk.resolution}
                renderMarkdown={isMarkdown && renderMode === "rendered"}
                onResolve={(resp) => props.onResolve(seg.hunk.requestId, resp)}
              />
            );
          })
        )}
      </div>

      {stats.pending > 0 && (
        <div className="rp__actions">
          <button className="rp__btn rp__btn--primary" onClick={props.onAcceptAll}>
            Accept all ({stats.pending})
          </button>
          <button className="rp__btn" onClick={() => setDiscussOpen((v) => !v)}>
            Discuss
          </button>
          <button className="rp__btn rp__btn--danger" onClick={props.onRejectAll}>
            Reject all
          </button>
        </div>
      )}
      {discussOpen && stats.pending > 0 && (
        <div className="rp__discuss">
          <textarea
            data-testid="rp-discuss-textarea"
            value={discussText}
            onChange={(e) => setDiscussText(e.target.value)}
            placeholder="One feedback message attached to every still-pending hunk…"
            rows={3}
          />
          <div className="rp__discuss-actions">
            <button
              className="rp__btn rp__btn--primary"
              onClick={() => {
                props.onDiscuss(discussText);
                setDiscussOpen(false);
                setDiscussText("");
              }}
            >
              Send to all pending
            </button>
            <button
              className="rp__btn"
              onClick={() => {
                setDiscussOpen(false);
                setDiscussText("");
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

// ── Segment builder ─────────────────────────────────────────

type Segment =
  | { kind: "text"; text: string; lineCount: number; isUnchangedFiller: boolean }
  | { kind: "hunk"; hunk: ReviewHunk; index: number };

function buildSegments(content: string, hunks: ReviewHunk[]): Segment[] {
  const segments: Segment[] = [];
  let cursor = 0;
  let hunkIdx = 0;
  for (const h of hunks) {
    hunkIdx += 1;
    let anchor = -1;
    if (h.oldString) {
      anchor = content.indexOf(h.oldString, cursor);
    } else if (h.section) {
      const m = new RegExp(`^#+\\s+${escapeRe(h.section)}\\s*$`, "m").exec(content.slice(cursor));
      anchor = m ? cursor + m.index + m[0].length : cursor;
    } else {
      anchor = cursor;
    }
    if (anchor === -1) {
      // Stale anchor — render at tail with no anchored text, hunk still shown.
      anchor = content.length;
    }
    const prefix = content.slice(cursor, anchor);
    if (prefix) pushText(segments, prefix);
    segments.push({ kind: "hunk", hunk: h, index: hunkIdx });
    cursor = anchor + h.oldString.length;
  }
  const tail = content.slice(cursor);
  if (tail) pushText(segments, tail);
  return segments;
}

function pushText(segments: Segment[], text: string) {
  const lineCount = (text.match(/\n/g) ?? []).length + 1;
  const isUnchangedFiller = lineCount > 6;
  segments.push({ kind: "text", text, lineCount, isUnchangedFiller });
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
