import { ConnectedSpecs } from "../sections/ConnectedSpecs.tsx";
import { LinkedTasks } from "../sections/LinkedTasks.tsx";
import { CoveredFiles } from "../sections/CoveredFiles.tsx";
import { SpecHealth } from "../sections/SpecHealth.tsx";

export function SpecContext() {
  return (
    <>
      <SpecHealth />
      <ConnectedSpecs />
      <LinkedTasks />
      <CoveredFiles />
    </>
  );
}
