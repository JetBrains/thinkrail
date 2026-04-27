import type { SpecEntry } from "@/types/spec.ts";

interface TaskCardProps {
  task: SpecEntry;
}

export function TaskCard({ task }: TaskCardProps) {
  return (
    <div className="task-card">
      <div className="task-card-title">{task.title}</div>
    </div>
  );
}
