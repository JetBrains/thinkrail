import { useMemo } from "react";
import { useSpecStore } from "@/store/specStore.ts";
import type { RegistryEntry } from "@/types/spec.ts";
import { KanbanColumn } from "./KanbanColumn.tsx";
import { TaskCard } from "./TaskCard.tsx";

const COLUMNS: { status: string; label: string }[] = [
  { status: "pending", label: "Pending" },
  { status: "active", label: "Active" },
  { status: "done", label: "Done" },
];

function normalizeStatus(status: string): string {
  if (status === "draft" || status === "pending") return "pending";
  if (status === "active" || status === "in-progress") return "active";
  if (status === "done" || status === "completed") return "done";
  return "pending";
}

export function TaskBoard() {
  const specs = useSpecStore((s) => s.specs);

  const taskSpecs = useMemo(
    () => specs.filter((s) => s.type === "task-spec"),
    [specs],
  );

  const grouped = useMemo(() => {
    const map = new Map<string, RegistryEntry[]>();
    for (const col of COLUMNS) map.set(col.status, []);
    for (const t of taskSpecs) {
      const col = normalizeStatus(t.status);
      const list = map.get(col);
      if (list) list.push(t);
    }
    return map;
  }, [taskSpecs]);

  return (
    <>
      <div className="board-section-header">
        <span className="board-section-title">Implementation Tasks (Legacy)</span>
        <span className="board-section-info">From spec registry</span>
      </div>
      <div className="kanban-columns">
        {COLUMNS.map((col) => {
          const items = grouped.get(col.status) ?? [];
          return (
            <KanbanColumn key={col.status} id={`task-${col.status}`} title={col.label} count={items.length}>
              {items.map((t) => (
                <TaskCard key={t.id} task={t} />
              ))}
            </KanbanColumn>
          );
        })}
      </div>
    </>
  );
}
