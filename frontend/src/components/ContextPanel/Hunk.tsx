import { useEffect, useState } from "react";
import { Editor } from "@monaco-editor/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { wordDiff } from "@/utils/wordDiff.ts";
import { useMonacoTheme } from "@/components/MarkdownEditor/useMonacoTheme.ts";
import "./Hunk.css";

export type ProposeChangeResponse =
  | { behavior: "allow"; applied: "original" }
  | { behavior: "allow"; applied: "edited"; edited_new_string: string }
  | { behavior: "deny"; discuss: true; feedback: string }
  | { behavior: "deny"; discuss: false };

export type HunkState = "pending" | "accepted" | "rejected" | "editing" | "discussing";

export interface HunkProps {
  requestId: string;
  index: number;
  oldString: string;
  newString: string;
  language: string;
  rationale?: string | null;
  section?: string | null;
  validationWarnings: { kind: string; message: string }[];
  state: HunkState;
  resolution: Record<string, unknown> | null;
  /** When true, the block-style preview renders newString as markdown. */
  renderMarkdown?: boolean;
  onResolve: (response: ProposeChangeResponse) => void;
}

export function Hunk(props: HunkProps) {
  const [innerState, setInnerState] = useState<"idle" | "editing" | "discussing">("idle");
  const [editedText, setEditedText] = useState(props.newString);
  const [feedback, setFeedback] = useState("");
  const monacoTheme = useMonacoTheme();

  const visualState: HunkState =
    innerState === "editing"
      ? "editing"
      : innerState === "discussing"
        ? "discussing"
        : props.state;

  useEffect(() => {
    if (innerState !== "editing") setEditedText(props.newString);
    if (innerState !== "discussing") setFeedback("");
  }, [innerState, props.newString]);

  return (
    <div className={`hunk hunk--${visualState}`} data-request-id={props.requestId}>
      <div className="hunk__index">{props.index}</div>
      <div className="hunk__body">
        {visualState === "editing" ? (
          <div className="hunk__edit">
            <Editor
              value={editedText}
              language={props.language}
              theme={monacoTheme}
              height={Math.min(240, Math.max(80, editedText.split("\n").length * 20))}
              onChange={(v) => setEditedText(v ?? "")}
              options={{
                minimap: { enabled: false },
                fontSize: 13,
                fontFamily: "'JetBrains Mono', 'Fira Code', 'SF Mono', monospace",
                lineNumbers: "off",
                automaticLayout: true,
                scrollBeyondLastLine: false,
                wordWrap: "on",
              }}
            />
          </div>
        ) : visualState === "discussing" ? (
          <>
            <DiffPreview
              oldString={props.oldString}
              newString={props.newString}
              renderMarkdown={props.renderMarkdown}
            />
            <textarea
              data-testid="hunk-discuss-textarea"
              className="hunk__discuss-textarea"
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              placeholder="What should change about this proposal?"
              rows={4}
            />
          </>
        ) : (
          <DiffPreview
            oldString={props.oldString}
            newString={props.newString}
            renderMarkdown={props.renderMarkdown}
          />
        )}

        {props.validationWarnings.length > 0 && (
          <div className="hunk__warnings">
            {props.validationWarnings.map((w, i) => (
              <div key={i} className={`hunk__warn hunk__warn--${w.kind}`}>
                {w.message}
              </div>
            ))}
          </div>
        )}

        <div className="hunk__toolbar">
          {props.rationale && <span className="hunk__why">▸ {props.rationale}</span>}
          <span className="hunk__spacer" />
          {visualState === "pending" && (
            <>
              <button
                className="hunk__btn hunk__btn--accept"
                onClick={() => props.onResolve({ behavior: "allow", applied: "original" })}
              >
                ✓ Accept
              </button>
              <button
                className="hunk__btn hunk__btn--edit"
                onClick={() => setInnerState("editing")}
              >
                ✎ Edit
              </button>
              <button
                className="hunk__btn hunk__btn--discuss"
                onClick={() => setInnerState("discussing")}
              >
                💬 Discuss
              </button>
              <button
                className="hunk__btn hunk__btn--reject"
                onClick={() => props.onResolve({ behavior: "deny", discuss: false })}
              >
                ✕ Reject
              </button>
            </>
          )}
          {visualState === "editing" && (
            <>
              <button
                className="hunk__btn hunk__btn--accept"
                onClick={() => {
                  props.onResolve({
                    behavior: "allow",
                    applied: "edited",
                    edited_new_string: editedText,
                  });
                  setInnerState("idle");
                }}
              >
                Apply edit
              </button>
              <button className="hunk__btn" onClick={() => setInnerState("idle")}>
                Cancel
              </button>
            </>
          )}
          {visualState === "discussing" && (
            <>
              <button
                className="hunk__btn hunk__btn--discuss"
                onClick={() => {
                  props.onResolve({ behavior: "deny", discuss: true, feedback });
                  setInnerState("idle");
                }}
              >
                Send feedback
              </button>
              <button className="hunk__btn" onClick={() => setInnerState("idle")}>
                Cancel
              </button>
            </>
          )}
          {visualState === "accepted" && (
            <span className="hunk__status hunk__status--accepted">Accepted</span>
          )}
          {visualState === "rejected" && (
            <span className="hunk__status hunk__status--rejected">Rejected</span>
          )}
        </div>
      </div>
    </div>
  );
}

function DiffPreview({
  oldString,
  newString,
  renderMarkdown,
}: {
  oldString: string;
  newString: string;
  renderMarkdown?: boolean;
}) {
  // Inline word-diff only when the change is small and single-paragraph;
  // markdown rendering doesn't apply to this branch because the inline
  // word-diff is itself a visual diff, not a render.
  if (
    !renderMarkdown &&
    oldString.length <= 200 &&
    newString.length <= 200 &&
    !oldString.includes("\n\n") &&
    !newString.includes("\n\n")
  ) {
    const segs = wordDiff(oldString, newString);
    return (
      <span className="hunk__diff hunk__diff--inline">
        {segs.map((s, i) => (
          <span key={i} className={`hunk__seg hunk__seg--${s.kind}`}>
            {s.text}
          </span>
        ))}
      </span>
    );
  }
  return (
    <div className="hunk__diff hunk__diff--block">
      {oldString && (
        <div className="hunk__block hunk__block--removed">
          {renderMarkdown ? (
            <div className="hunk__md">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{oldString}</ReactMarkdown>
            </div>
          ) : (
            oldString
          )}
        </div>
      )}
      {newString && (
        <div className="hunk__block hunk__block--added">
          {renderMarkdown ? (
            <div className="hunk__md">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{newString}</ReactMarkdown>
            </div>
          ) : (
            newString
          )}
        </div>
      )}
    </div>
  );
}
