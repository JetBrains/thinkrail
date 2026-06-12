import { useState, type ReactNode } from "react";
import { ArrowRightFromLine, ArrowLeftFromLine } from "lucide-react";
import "./TwoPanelLayout.css";

interface TwoPanelLayoutProps {
  leftPanel: ReactNode;
  rightPanel: ReactNode;
  rightPanelTitle?: string;
}

/**
 * Two-panel layout with sphere background and blurred container.
 * Left panel contains chat input, right panel contains document/content.
 * Based on FullScreenLayout with split panel design.
 * Right panel is collapsible.
 */
export function TwoPanelLayout({ leftPanel, rightPanel, rightPanelTitle }: TwoPanelLayoutProps) {
  const [rightCollapsed, setRightCollapsed] = useState(false);

  return (
    <div className="twopanel-layout">
      <div className="twopanel-container">
        <div className="twopanel-left">
          {leftPanel}
        </div>
        <div className={`twopanel-right${rightCollapsed ? " twopanel-right--collapsed" : ""}`}>
          {rightCollapsed ? (
            <>
              {rightPanelTitle && (
                <div className="twopanel-collapsed-title">
                  <span>{rightPanelTitle}</span>
                </div>
              )}
              <button
                className="twopanel-expand-btn"
                onClick={() => setRightCollapsed(false)}
                title="Expand panel"
              >
                <ArrowLeftFromLine size={16} />
              </button>
            </>
          ) : (
            <>
              <button
                className="twopanel-collapse-btn"
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
    </div>
  );
}
