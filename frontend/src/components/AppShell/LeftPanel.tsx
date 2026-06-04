import { LEFT_BROWSER_TABS, useUiStore } from "@/store/uiStore.ts";
import { useBoardStore } from "@/store/boardStore.ts";
import { FileTree } from "@/components/FileTree/FileTree.tsx";
import { SpecTree } from "@/components/SpecTree/SpecTree.tsx";
import { SessionManager } from "@/components/SessionManager/SessionManager.tsx";
import { TicketInfo } from "@/components/TicketDetail/TicketInfo.tsx";
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
  const centerView = useUiStore((s) => s.centerView);
  const activeTicketId = useBoardStore((s) => s.activeTicketId);
  const inTicketRoute = centerView === "board" && activeTicketId != null;

  // Ticket route replaces the tab strip's content with the ticket phase
  // tree. Panel itself behaves normally — resizable, Cmd+B collapse still
  // works, and the in-panel collapse caret stays in the top-right. The
  // persisted leftActiveTab is left untouched so leaving the route
  // restores whichever tab the user had selected.
  if (inTicketRoute) {
    return (
      <div className="left-panel left-panel--ticket">
        <div className="panel-tabs panel-tabs--ticket">
          <span className="panel-tab panel-tab-active panel-tab--static">Ticket</span>
          <PanelCollapseButton side="left" shortcut="B" />
        </div>
        <div className="left-panel-ticket-body">
          <TicketInfo />
        </div>
      </div>
    );
  }

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
