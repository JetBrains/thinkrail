import { useMemo } from "react";
import { CollapsibleSection } from "../CollapsibleSection.tsx";
import { useSelectedSpec } from "../useSelectedSpec.ts";
import { useSpecStore } from "@/store/specStore.ts";
import type { RegistryEntry } from "@/types/spec.ts";
import "./LinkedTasks.css";

const STATUS_ORDER: Record<string, number> = { active: 0, draft: 1, done: 2, blocked: 3 };

export function LinkedTasks() {
  const spec = useSelectedSpec();
  const graph = useSpecStore((s) => s.graph);
  const specs = useSpecStore((s) => s.specs);
  const selectSpec = useSpecStore((s) => s.selectSpec);

  const tasks = useMemo<RegistryEntry[]>(() => {
    if (!spec || !graph) return [];
    const specId = spec.id;
    const specMap = new Map(specs.map((s) => [s.id, s]));

    const taskIds = graph.edges
      .filter((e) => e.type === "implements" && e.to === specId)
      .map((e) => e.from);

    return taskIds
      .map((id) => specMap.get(id))
      .filter((entry): entry is RegistryEntry => !!entry && entry.type.startsWith("task"))
      .sort((a, b) => (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9));
  }, [spec, graph, specs]);

  return (
    <CollapsibleSection title="Tasks" count={tasks.length || undefined}>
      {tasks.length === 0 ? (
        <div className="section-placeholder">No tasks linked to this spec</div>
      ) : (
        tasks.map((task) => (
          <button
            key={task.id}
            className="linked-task"
            onClick={() => selectSpec(task.id)}
          >
            <span className="linked-task__status" data-status={task.status} />
            <span className="linked-task__title">{task.title}</span>
          </button>
        ))
      )}
    </CollapsibleSection>
  );
}
