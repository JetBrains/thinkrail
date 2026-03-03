import { useUiStore } from "@/store/uiStore.ts";
import { GraphView } from "@/components/GraphView/GraphView.tsx";
import { ConsoleView } from "@/components/Console/ConsoleView.tsx";
import { DiffView } from "@/components/DiffViewer/DiffView.tsx";

const TABS = ["graph", "spec", "code", "diff", "console"] as const;
const TAB_LABELS: Record<(typeof TABS)[number], string> = {
  graph: "Graph",
  spec: "Spec",
  code: "Code",
  diff: "Diff",
  console: "Console",
};

const FLEX_TABS = new Set(["graph", "console", "diff"]);

function TabContent({ tab }: { tab: string }) {
  if (tab === "graph") return <GraphView />;
  if (tab === "console") return <ConsoleView />;
  if (tab === "diff") return <DiffView />;
  return <div className="panel-placeholder">{TAB_LABELS[tab as keyof typeof TAB_LABELS]}</div>;
}

export function RightPanel() {
  const activeTab = useUiStore((s) => s.rightActiveTab);
  const setTab = useUiStore((s) => s.setRightTab);

  return (
    <div className="right-panel">
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
      <div
        className="panel-content"
        style={FLEX_TABS.has(activeTab) ? { padding: 0, display: "flex" } : undefined}
      >
        <TabContent tab={activeTab} />
      </div>
    </div>
  );
}
