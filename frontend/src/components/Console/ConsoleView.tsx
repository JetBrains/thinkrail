import "./ConsoleView.css";

/**
 * Console — stub component.
 * Requires backend /terminal/* WebSocket endpoints (not yet implemented).
 * Will use xterm.js when backend is ready.
 */
export function ConsoleView() {
  return (
    <div className="console-stub">
      <div className="console-stub-icon">{"\u{1F4BB}"}</div>
      <div className="console-stub-title">Terminal</div>
      <div className="console-stub-text">
        Requires backend terminal endpoints.
        <br />
        Coming in a future update.
      </div>
    </div>
  );
}
