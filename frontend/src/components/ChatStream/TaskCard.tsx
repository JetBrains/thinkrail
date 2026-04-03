type CardState = "running" | "success" | "error";

interface TaskCardProps {
  toolName: string;
  toolInput: Record<string, unknown>;
  state: CardState;
  isError?: boolean;
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

export function TaskCard({ toolName, toolInput, state, isError }: TaskCardProps) {
  const borderColor =
    state === "running"
      ? "var(--blue)"
      : isError
        ? "var(--red)"
        : "var(--green)";

  const stateIcon =
    state === "running" ? "\u25CF" : isError ? "\u2715" : "\u2713";

  if (toolName === "TodoWrite") {
    const todos = parseTodos(toolInput);
    const doneCount = todos.filter((t) => t.status === "completed").length;
    return (
      <div className="chat-tool" style={{ borderLeftColor: borderColor }}>
        <div className="chat-tool-header">
          <span className="chat-tool-icon">{"\u2611"}</span>
          <span className="chat-tool-name">Tasks</span>
          <span className="chat-tool-input">
            {todos.length > 0 ? `${doneCount} of ${todos.length} done` : ""}
          </span>
          <span className="chat-tool-status" style={{ color: borderColor }}>
            {stateIcon}
          </span>
        </div>
        {todos.length > 0 && (
          <div className="chat-tool-body" style={{ resize: "none", minHeight: "auto" }}>
            <div className="task-list">
              {todos.map((todo, i) => {
                const s = statusIcon(todo.status);
                return (
                  <div key={todo.id ?? i} className={`task-item ${s.className}`}>
                    <span className="task-status-icon" style={{ color: statusColor(todo.status) }}>
                      {s.icon}
                    </span>
                    <span>{todo.content ?? ""}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  }

  if (toolName === "TaskCreate") {
    const subject = (toolInput.subject as string) ?? "";
    return (
      <div className="chat-tool" style={{ borderLeftColor: borderColor }}>
        <div className="chat-tool-header">
          <span className="chat-tool-icon">{"\u2611"}</span>
          <span className="chat-tool-name">Task Created</span>
          {subject && <span className="chat-tool-input">{subject}</span>}
          <span className="chat-tool-status" style={{ color: borderColor }}>
            {stateIcon}
          </span>
        </div>
      </div>
    );
  }

  if (toolName === "TaskUpdate") {
    const taskId = (toolInput.taskId as string) ?? "";
    const newStatus = (toolInput.status as string) ?? "";
    return (
      <div className="chat-tool" style={{ borderLeftColor: borderColor }}>
        <div className="chat-tool-header">
          <span className="chat-tool-icon">{"\u2611"}</span>
          <span className="chat-tool-name">Task #{taskId}</span>
          {newStatus && (
            <span className="chat-tool-input" style={{ color: statusColor(newStatus) }}>
              {statusIcon(newStatus).icon} {newStatus.replace("_", " ")}
            </span>
          )}
          <span className="chat-tool-status" style={{ color: borderColor }}>
            {stateIcon}
          </span>
        </div>
      </div>
    );
  }

  return null;
}
