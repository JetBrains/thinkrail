import type { ReactNode } from "react";
import { useDroppable } from "@dnd-kit/react";
import { CollisionPriority } from "@dnd-kit/abstract";

interface KanbanColumnProps {
  id: string;
  title: string;
  count: number;
  children: ReactNode;
}

export function KanbanColumn({ id, title, count, children }: KanbanColumnProps) {
  const { ref, isDropTarget } = useDroppable({
    id,
    type: "column",
    accept: "item",
    collisionPriority: CollisionPriority.Low,
  });

  return (
    <div className={`kanban-column ${isDropTarget ? "kanban-column--drop-target" : ""}`} ref={ref}>
      <div className="kanban-column-header">
        {title}
        <span className="kanban-column-count">{count}</span>
      </div>
      <div className="kanban-column-items">
        {count === 0 && <div className="kanban-column-empty">No tickets</div>}
        {children}
      </div>
    </div>
  );
}
