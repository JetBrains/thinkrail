export interface ChecklistItem {
  key?: string;
  label: string;
  status?: string;
}

function statusIcon(status?: string): { icon: string; className: string } {
  switch (status) {
    case "completed":
      return { icon: "✓", className: "task-item--completed" };
    case "in_progress":
      return { icon: "◉", className: "task-item--in-progress" };
    default:
      return { icon: "○", className: "task-item--pending" };
  }
}

function statusColor(status?: string): string {
  switch (status) {
    case "completed":
      return "var(--green)";
    case "in_progress":
      return "var(--gold)";
    default:
      return "var(--muted)";
  }
}

export function TaskChecklist({ items }: { items: ChecklistItem[] }) {
  if (items.length === 0) return null;
  return (
    <div className="task-list" data-task-checklist>
      {items.map((item, i) => {
        const s = statusIcon(item.status);
        return (
          <div key={item.key ?? i} className={`task-item ${s.className}`}>
            <span className="task-status-icon" style={{ color: statusColor(item.status) }}>
              {s.icon}
            </span>
            <span>{item.label}</span>
          </div>
        );
      })}
    </div>
  );
}
