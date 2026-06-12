import type { ReactNode } from "react";
import "./SessionsViewLayout.css";

interface SessionsViewLayoutProps {
  leftPanel: ReactNode;
  mainContent: ReactNode;
}

/**
 * Layout container for sessions view with sphere background and island-style panels.
 * Left panel is an island (260px fixed width), main content uses TwoPanelLayout.
 */
export function SessionsViewLayout({ leftPanel, mainContent }: SessionsViewLayoutProps) {
  return (
    <div className="sessions-view-layout">
      <div className="sessions-view-container">
        <div className="sessions-view-left">
          {leftPanel}
        </div>
        <div className="sessions-view-main">
          {mainContent}
        </div>
      </div>
    </div>
  );
}
