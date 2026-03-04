import { SpecCoverage } from "../sections/SpecCoverage.tsx";
import { OpenTasks } from "../sections/OpenTasks.tsx";
import { RecentActivity } from "../sections/RecentActivity.tsx";

export function ProjectDashboard() {
  return (
    <>
      <SpecCoverage />
      <OpenTasks />
      <RecentActivity />
    </>
  );
}
