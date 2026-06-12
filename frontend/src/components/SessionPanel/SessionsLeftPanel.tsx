import { useState } from "react";
import { ArrowRightFromLine, ArrowLeftFromLine } from "lucide-react";
import { FileTree } from "@/components/FileTree/FileTree.tsx";
import { SpecTree } from "@/components/SpecTree/SpecTree.tsx";
import { SessionManager } from "@/components/SessionManager/SessionManager.tsx";
import { ResizeHandle } from "@/components/AppShell/ResizeHandle.tsx";
import "./SessionsLeftPanel.css";

type SessionsLeftTab = "sessions" | "specs" | "files";

const TAB_LABELS: Record<SessionsLeftTab, string> = {
  sessions: "Sessions",
  specs: "Specs",
  files: "Files",
};

function TabContent({ tab }: { tab: SessionsLeftTab }) {
  switch (tab) {
    case "sessions":
      return (
        <div className="sessions-left-sessions-content">
          <SessionManager />
        </div>
      );
    case "specs":
      return <SpecTree />;
    case "files":
      return <FileTree />;
  }
}

const DEFAULT_WIDTH = 360;
const MIN_WIDTH = 200;
const MAX_WIDTH = 600;
const COLLAPSE_THRESHOLD = 150;

export function SessionsLeftPanel() {
  const [activeTab, setActiveTab] = useState<SessionsLeftTab>("sessions");
  const [collapsed, setCollapsed] = useState(false);
  const [width, setWidth] = useState(DEFAULT_WIDTH);

  return (
    <div style={{ display: "flex", height: "100%" }}>
      <div
        className={`sessions-left-panel${collapsed ? " sessions-left-panel--collapsed" : ""}`}
        style={{ width: collapsed ? 48 : width }}
      >
        {collapsed ? (
          <button
            className="sessions-left-expand-btn"
            onClick={() => setCollapsed(false)}
            title="Expand panel"
          >
            <ArrowRightFromLine size={16} />
          </button>
        ) : (
          <>
            <div className="sessions-left-tabs">
              {(Object.keys(TAB_LABELS) as SessionsLeftTab[]).map((tab) => (
                <button
                  key={tab}
                  className={`sessions-left-tab ${activeTab === tab ? "sessions-left-tab-active" : ""}`}
                  onClick={() => setActiveTab(tab)}
                >
                  {TAB_LABELS[tab]}
                </button>
              ))}
              <button
                className="sessions-left-collapse-btn"
                onClick={() => setCollapsed(true)}
                title="Collapse panel"
              >
                <ArrowLeftFromLine size={16} />
              </button>
            </div>
            <div className="sessions-left-content">
              <TabContent tab={activeTab} />
            </div>
          </>
        )}
      </div>
      {!collapsed && (
        <ResizeHandle
          side="left"
          panelWidth={width}
          onResize={setWidth}
          onCollapse={() => setCollapsed(true)}
          min={MIN_WIDTH}
          max={MAX_WIDTH}
          collapseThreshold={COLLAPSE_THRESHOLD}
          handleWidth={2}
          restColor="transparent"
          hoverColor="var(--primary)"
        />
      )}
    </div>
  );
}
