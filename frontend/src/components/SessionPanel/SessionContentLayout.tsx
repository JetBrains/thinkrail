import { useState, type ReactNode } from "react";
import { ArrowRightFromLine, ArrowLeftFromLine } from "lucide-react";
import { ResizeHandle } from "@/components/AppShell/ResizeHandle.tsx";
import "./SessionContentLayout.css";

interface SessionContentLayoutProps {
  leftPanel: ReactNode;
  rightPanel?: ReactNode;
  rightPanelTitle?: string;
}

const DEFAULT_RIGHT_WIDTH = 360;
const MIN_RIGHT_WIDTH = 240;
const MAX_RIGHT_WIDTH = 680;
const RIGHT_COLLAPSE_THRESHOLD = 180;

/**
 * Two-panel content layout without background wrapper.
 * Used within SessionsViewLayout which provides the sphere background.
 * Left panel is flexible; the right panel has a fixed, drag-resizable width
 * (drag its left edge) and can be collapsed.
 */
export function SessionContentLayout({ leftPanel, rightPanel, rightPanelTitle }: SessionContentLayoutProps) {
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [rightWidth, setRightWidth] = useState(DEFAULT_RIGHT_WIDTH);

  if (!rightPanel) {
    return <div className="session-content-single">{leftPanel}</div>;
  }

  return (
    <div className="session-content-layout">
      <div className="session-content-left">
        {leftPanel}
      </div>
      {!rightCollapsed && (
        <ResizeHandle
          side="right"
          panelWidth={rightWidth}
          onResize={setRightWidth}
          onCollapse={() => setRightCollapsed(true)}
          min={MIN_RIGHT_WIDTH}
          max={MAX_RIGHT_WIDTH}
          collapseThreshold={RIGHT_COLLAPSE_THRESHOLD}
          handleWidth={2}
          restColor="transparent"
          hoverColor="var(--primary)"
        />
      )}
      <div
        className={`session-content-right${rightCollapsed ? " session-content-right--collapsed" : ""}`}
        style={rightCollapsed ? undefined : { flex: `0 0 ${rightWidth}px`, width: rightWidth }}
      >
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
