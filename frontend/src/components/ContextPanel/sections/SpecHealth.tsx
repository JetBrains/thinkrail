import { CollapsibleSection } from "../CollapsibleSection.tsx";

export function SpecHealth() {
  return (
    <CollapsibleSection title="Spec Health" defaultExpanded={false}>
      <div className="section-placeholder">Spec health summary will appear here</div>
    </CollapsibleSection>
  );
}
