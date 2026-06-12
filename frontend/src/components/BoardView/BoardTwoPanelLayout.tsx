import type { ReactNode } from "react";
import "./BoardTwoPanelLayout.css";

interface BoardTwoPanelLayoutProps {
  leftPanel: ReactNode;
  rightPanel?: ReactNode;
}

/**
 * Two-panel layout for board view with sphere background and two separate blurred islands.
 * Left panel is flexible, right panel is fixed at 400px width.
 */
export function BoardTwoPanelLayout({ leftPanel, rightPanel }: BoardTwoPanelLayoutProps) {
  return (
    <div className="board-twopanel-layout">
      <div className="board-twopanel-container">
        <div className="board-twopanel-left">
          {leftPanel}
        </div>
        {rightPanel && (
          <div className="board-twopanel-right">
            {rightPanel}
          </div>
        )}
      </div>
    </div>
  );
}
