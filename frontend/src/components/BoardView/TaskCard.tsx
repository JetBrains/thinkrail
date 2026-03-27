import type { RegistryEntry } from "@/types/spec.ts";

interface TaskCardProps {
  task: RegistryEntry;
}

export function TaskCard({ task }: TaskCardProps) {
  return (
    <div className="task-card">
      <div className="task-card-title">{task.title}</div>
    </div>
  );
}
