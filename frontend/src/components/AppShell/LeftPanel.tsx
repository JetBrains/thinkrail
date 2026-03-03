import { useUiStore } from "@/store/uiStore.ts";
import { ProgressTab } from "@/components/ProgressTab/ProgressTab.tsx";

const TABS = ["specs", "reqs", "files", "progress"] as const;
const TAB_LABELS: Record<(typeof TABS)[number], string> = {
  specs: "Specs",
  reqs: "Reqs",
  files: "Files",
  progress: "Progress",
};

function TabContent({ tab }: { tab: string }) {
  if (tab === "progress") return <ProgressTab />;
  return <div className="panel-placeholder">{TAB_LABELS[tab as keyof typeof TAB_LABELS]}</div>;
}

export function LeftPanel() {
  const activeTab = useUiStore((s) => s.leftActiveTab);
  const setTab = useUiStore((s) => s.setLeftTab);

  return (
    <div className="left-panel">
      <div className="panel-tabs">
        {TABS.map((tab) => (
          <button
            key={tab}
            className={`panel-tab ${activeTab === tab ? "panel-tab-active" : ""}`}
            onClick={() => setTab(tab)}
          >
            {TAB_LABELS[tab]}
          </button>
        ))}
      </div>
      <div className="panel-content">
        <TabContent tab={activeTab} />
      </div>
    </div>
  );
}
