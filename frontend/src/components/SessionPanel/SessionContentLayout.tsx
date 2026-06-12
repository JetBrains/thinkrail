import { useState, type ReactNode } from "react";
import { ArrowRightFromLine, ArrowLeftFromLine } from "lucide-react";
import "./SessionContentLayout.css";

interface SessionContentLayoutProps {
  leftPanel: ReactNode;
  rightPanel?: ReactNode;
  rightPanelTitle?: string;
}

/**
 * Two-panel content layout without background wrapper.
 * Used within SessionsViewLayout which provides the sphere background.
 * Left panel is flexible, right panel is collapsible.
 */
export function SessionContentLayout({ leftPanel, rightPanel, rightPanelTitle }: SessionContentLayoutProps) {
  const [rightCollapsed, setRightCollapsed] = useState(false);

  if (!rightPanel) {
    return <div className="session-content-single">{leftPanel}</div>;
  }

  return (
    <div className="session-content-layout">
      <div className="session-content-left">
        {leftPanel}
      </div>
      <div className={`session-content-right${rightCollapsed ? " session-content-right--collapsed" : ""}`}>
        {rightCollapsed ? (
          <>
            {rightPanelTitle && (
              <div className="session-content-collapsed-title">
                <span>{rightPanelTitle}</span>
              </div>
            )}
            <button
              className="session-content-expand-btn"
              onClick={() => setRightCollapsed(false)}
              title="Expand panel"
            >
              <ArrowLeftFromLine size={16} />
            </button>
          </>
        ) : (
          <>
            <button
              className="session-content-collapse-btn"
              onClick={() => setRightCollapsed(true)}
              title="Collapse panel"
            >
              <ArrowRightFromLine size={16} />
            </button>
            {rightPanel}
          </>
        )}
      </div>
    </div>
  );
}
