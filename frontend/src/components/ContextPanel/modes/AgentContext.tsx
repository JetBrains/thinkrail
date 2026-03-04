import { TaskSpecPreview } from "../sections/TaskSpecPreview.tsx";
import { FilesModified } from "../sections/FilesModified.tsx";
import { RelatedSpecs } from "../sections/RelatedSpecs.tsx";
import { ComplianceHints } from "../sections/ComplianceHints.tsx";

export function AgentContext() {
  return (
    <>
      <TaskSpecPreview />
      <FilesModified />
      <RelatedSpecs />
      <ComplianceHints />
    </>
  );
}
