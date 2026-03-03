import "./DiffView.css";

/**
 * Diff Viewer — stub component.
 * Requires backend diff/* RPC methods (not yet implemented).
 */
export function DiffView() {
  return (
    <div className="diff-stub">
      <div className="diff-stub-icon">{"\u{1F4C4}"}</div>
      <div className="diff-stub-title">Diff Viewer</div>
      <div className="diff-stub-text">
        Spec-to-code diff requires backend diff/* methods.
        <br />
        Coming in a future update.
      </div>
    </div>
  );
}
