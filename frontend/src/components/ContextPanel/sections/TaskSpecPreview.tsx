import { CollapsibleSection } from "../CollapsibleSection.tsx";

export function TaskSpecPreview() {
  return (
    <CollapsibleSection
      title="Task Spec"
      expandToCenter={() => {
        // TODO: open task spec in center panel
      }}
    >
      <div className="section-placeholder">Task spec driving this session will appear here</div>
    </CollapsibleSection>
  );
}
