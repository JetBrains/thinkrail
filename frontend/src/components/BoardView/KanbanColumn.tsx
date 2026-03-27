import type { ReactNode } from "react";

interface KanbanColumnProps {
  title: string;
  count: number;
  children: ReactNode;
}

export function KanbanColumn({ title, count, children }: KanbanColumnProps) {
  return (
    <div className="kanban-column">
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
