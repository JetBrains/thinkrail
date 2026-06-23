import type { AgentEvent } from "@/types/agent.ts";
import { EventType } from "@/constants/eventTypes.ts";

export interface TodoSnapshotItem {
  key: string;
  content: string;
  status: string;
}

export interface TodoSnapshot {
  todos: TodoSnapshotItem[];
  /** event-index when this key's status most recently changed */
  touchByKey: Map<string, number>;
}

/** Build a "Tasks (n/m)" snapshot from a session's event log.
 *
 *  Handles both protocols the agent SDK might emit:
 *
 *  - `TodoWrite` (pre-v2.1.142): each call carries the full task list in
 *    `toolInput.todos`. Each call REPLACES the snapshot.
 *  - `TaskCreate` / `TaskUpdate` (SDK ≥ 0.2.83 default): incremental.
 *    `TaskCreate` adds one task with a sequential id ("1", "2", ...);
 *    `TaskUpdate` mutates an entry by `taskId` (or removes it with
 *    `status: "deleted"`).
 *
 *  Events are walked in order; the snapshot at the end is what's returned.
 *  Returns null when the session emitted no task events. */
export function deriveSessionTodoState(events: AgentEvent[]): TodoSnapshot | null {
  interface Item {
    key: string;
    subject: string;
    activeForm: string;
    status: string;
  }

  let taskById = new Map<string, Item>();
  let orderedKeys: string[] = [];
  const lastStatus = new Map<string, string>();
  const touchByKey = new Map<string, number>();
  let createCounter = 0;

  events.forEach((ev, idx) => {
    if (ev.eventType !== EventType.ToolCallStart) return;
    const payload = ev.payload as unknown as Record<string, unknown> | undefined;
    const toolName = payload?.toolName;
    const input = (payload?.toolInput ?? {}) as Record<string, unknown>;

    if (toolName === "TodoWrite") {
      const rawTodos = input.todos;
      if (!Array.isArray(rawTodos)) return;
      // TodoWrite carries the full list each call → reset and rebuild.
      taskById = new Map();
      orderedKeys = [];
      (rawTodos as Record<string, unknown>[]).forEach((t, i) => {
        const key = (t.id as string) ?? (t.content as string) ?? `idx${i}`;
        const subject = (t.content as string) ?? "";
        const status = (t.status as string) ?? "pending";
        const item: Item = { key, subject, activeForm: "", status };
        taskById.set(key, item);
        orderedKeys.push(key);
        if (lastStatus.get(key) !== status) {
          touchByKey.set(key, idx);
          lastStatus.set(key, status);
        }
      });
      return;
    }

    if (toolName === "TaskCreate") {
      createCounter += 1;
      const key = String(createCounter);
      const subject = typeof input.subject === "string" ? input.subject : "";
      const activeForm = typeof input.activeForm === "string" ? input.activeForm : "";
      const item: Item = { key, subject, activeForm, status: "pending" };
      taskById.set(key, item);
      orderedKeys.push(key);
      lastStatus.set(key, "pending");
      touchByKey.set(key, idx);
      return;
    }

    if (toolName === "TaskUpdate") {
      const key = typeof input.taskId === "string" ? input.taskId : "";
      if (!key) return;
      let item = taskById.get(key);
      if (!item) {
        item = { key, subject: "", activeForm: "", status: "pending" };
        taskById.set(key, item);
        orderedKeys.push(key);
      }
      const status = typeof input.status === "string" ? input.status : "";
      if (status === "deleted") {
        taskById.delete(key);
        orderedKeys = orderedKeys.filter((k) => k !== key);
        return;
      }
      if (status === "pending" || status === "in_progress" || status === "completed") {
        if (lastStatus.get(key) !== status) {
          item.status = status;
          touchByKey.set(key, idx);
          lastStatus.set(key, status);
        }
      }
      if (typeof input.subject === "string") item.subject = input.subject;
      if (typeof input.activeForm === "string") item.activeForm = input.activeForm;
    }
  });

  if (orderedKeys.length === 0) return null;

  const todos: TodoSnapshotItem[] = orderedKeys
    .map((k) => taskById.get(k))
    .filter((it): it is Item => !!it)
    .map((it) => ({
      key: it.key,
      content: it.status === "in_progress" && it.activeForm ? it.activeForm : it.subject,
      status: it.status,
    }));

  return { todos, touchByKey };
}
