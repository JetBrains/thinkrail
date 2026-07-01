import type { LiveActivity } from "@/hooks/useTaskSnapshot.ts";
import "./TaskTracker.css";

export function TaskActivityLine({ activity }: { activity: LiveActivity | null }) {
  if (!activity) return null;
  return (
    <div className="task-activity" title={activity.text}>
      <span className="task-activity__dot" aria-hidden="true" />
      <span className="task-activity__text">{activity.text}</span>
    </div>
  );
}
