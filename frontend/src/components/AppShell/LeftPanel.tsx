import { LEFT_BROWSER_TABS, useUiStore } from "@/store/uiStore.ts";
import { FileTree } from "@/components/FileTree/FileTree.tsx";
import { SpecTree } from "@/components/SpecTree/SpecTree.tsx";
import { SessionManager } from "@/components/SessionManager/SessionManager.tsx";
import { PanelCollapseButton } from "./PanelCollapseButton.tsx";

type BrowserTab = (typeof LEFT_BROWSER_TABS)[number];

const TAB_LABELS: Record<BrowserTab, string> = {
  specs: "Specs",
  files: "Files",
};

function TabContent({ tab }: { tab: BrowserTab }) {
  switch (tab) {
    case "specs":
      return <SpecTree />;
    case "files":
      return <FileTree />;
  }
}

export function LeftPanel() {
  const persistedTab = useUiStore((s) => s.leftActiveTab);
  const setTab = useUiStore((s) => s.setLeftTab);

  // Sessions is its own full-panel mode (opened from the header Sessions
  // button / StatusBar pill), not a tab in the Specs/Files strip. The
  // collapse caret lives in SessionManager's own header, next to Refresh.
  if (persistedTab === "sessions") {
    return (
      <div className="left-panel">
        <div className="panel-content panel-content-compact">
          <SessionManager />
        </div>
      </div>
    );
  }

  // Persisted value may be a deprecated tab no longer in the browser strip.
  const activeTab: BrowserTab = (LEFT_BROWSER_TABS as readonly string[]).includes(persistedTab)
    ? (persistedTab as BrowserTab)
    : LEFT_BROWSER_TABS[0];
  const compact = activeTab === "files";

  return (
    <div className="left-panel">
      <div className="panel-tabs">
        {LEFT_BROWSER_TABS.map((tab) => (
          <button
            key={tab}
            className={`panel-tab ${activeTab === tab ? "panel-tab-active" : ""}`}
            onClick={() => setTab(tab)}
          >
            {TAB_LABELS[tab]}
          </button>
        ))}
        <PanelCollapseButton side="left" shortcut="B" />
      </div>
      <div className={`panel-content ${compact ? "panel-content-compact" : ""}`}>
        <TabContent tab={activeTab} />
      </div>
    </div>
  );
}
