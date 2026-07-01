import type { TaskItem } from "./renderers/types.ts";
import { CardState } from "@/constants/status.ts";
import { TaskChecklist } from "./TaskChecklist.tsx";

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
          <TaskChecklist items={items.map((t) => ({ key: t.id, label: t.label, status: t.status }))} />
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
