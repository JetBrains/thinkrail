import type { TaskItem } from "./renderers/types.ts";
import { CardState } from "@/constants/status.ts";

interface TaskCardProps {
  toolName: string;
  toolInput: Record<string, unknown>;
  state: CardState;
  isError?: boolean;
  tasks?: TaskItem[];
}

interface TodoItem {
  id?: string;
  content?: string;
  status?: string;
}

function parseTodos(toolInput: Record<string, unknown>): TodoItem[] {
  const raw = toolInput.todos;
  if (!Array.isArray(raw)) return [];
  return raw as TodoItem[];
}

function statusIcon(status?: string): { icon: string; className: string } {
  switch (status) {
    case "completed":
      return { icon: "\u2713", className: "task-item--completed" };
    case "in_progress":
      return { icon: "\u25C9", className: "task-item--in-progress" };
    default:
      return { icon: "\u25CB", className: "task-item--pending" };
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

interface ChecklistItem {
  id?: string;
  label: string;
  status?: string;
}

function ChecklistCard({
  items,
  borderColor,
  stateIcon,
}: {
  items: ChecklistItem[];
  borderColor: string;
  stateIcon: string;
}) {
  const doneCount = items.filter((t) => t.status === "completed").length;
  return (
    <div className="chat-tool" style={{ borderLeftColor: borderColor }}>
      <div className="chat-tool-header">
        <span className="chat-tool-icon">{"☑"}</span>
        <span className="chat-tool-name">Tasks</span>
        <span className="chat-tool-input">
          {items.length > 0 ? `${doneCount} of ${items.length} done` : ""}
        </span>
        <span className="chat-tool-status" style={{ color: borderColor }}>
          {stateIcon}
        </span>
      </div>
      {items.length > 0 && (
        <div className="chat-tool-body" style={{ resize: "none", minHeight: "auto" }}>
          <div className="task-list">
            {items.map((item, i) => {
              const s = statusIcon(item.status);
              return (
                <div key={item.id ?? i} className={`task-item ${s.className}`}>
                  <span className="task-status-icon" style={{ color: statusColor(item.status) }}>
                    {s.icon}
                  </span>
                  <span>{item.label}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export function TaskCard({ toolName, toolInput, state, isError, tasks }: TaskCardProps) {
  const borderColor =
    state === CardState.Running
      ? "var(--blue)"
      : isError
        ? "var(--red)"
        : "var(--green)";

  const stateIcon =
    state === CardState.Running ? "●" : isError ? "✕" : "✓";

  if (toolName === "TodoWrite") {
    const todos = parseTodos(toolInput);
    const items: ChecklistItem[] = todos.map((t) => ({
      id: t.id,
      label: t.content ?? "",
      status: t.status,
    }));
    return <ChecklistCard items={items} borderColor={borderColor} stateIcon={stateIcon} />;
  }

  if (tasks) {
    const items: ChecklistItem[] = tasks.map((t) => ({
      id: t.id,
      label: t.status === "in_progress" && t.activeForm ? t.activeForm : (t.subject ?? ""),
      status: t.status,
    }));
    return <ChecklistCard items={items} borderColor={borderColor} stateIcon={stateIcon} />;
  }

  return null;
}
