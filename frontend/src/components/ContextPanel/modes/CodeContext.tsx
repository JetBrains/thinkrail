import { CoveringSpecs } from "../sections/CoveringSpecs.tsx";
import { RelatedTasks } from "../sections/RelatedTasks.tsx";
import { SpecHealth } from "../sections/SpecHealth.tsx";

export function CodeContext() {
  return (
    <>
      <CoveringSpecs />
      <RelatedTasks />
      <SpecHealth />
    </>
  );
}
