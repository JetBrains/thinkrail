import { CollapsibleSection } from "../CollapsibleSection.tsx";
import { GraphView } from "@/components/GraphView/GraphView.tsx";

export function ConnectedSpecs() {
  return (
    <CollapsibleSection
      title="Connected Specs"
      expandToCenter={() => {
        // TODO: open full GraphView in center panel
      }}
    >
      <div style={{ height: 280, display: "flex" }}>
        <GraphView />
      </div>
    </CollapsibleSection>
  );
}
