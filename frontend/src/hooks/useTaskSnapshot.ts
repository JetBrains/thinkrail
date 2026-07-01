import { useMemo } from "react";
import type { AgentEvent } from "@/types/agent.ts";
import { EventType } from "@/constants/eventTypes.ts";
import { SessionStatus, isStreaming } from "@/constants/status.ts";
import { useSessionStore } from "@/store/sessionStore.ts";

export interface TaskSnapshotItem {
  key: string;
  content: string;
  status: "pending" | "in_progress" | "completed";
}

export interface LiveActivity {
  toolName: string;
  file?: string;
  text: string;
}

export interface TaskSnapshot {
  items: TaskSnapshotItem[];
  done: number;
  total: number;
  activity: LiveActivity | null;
  running: boolean;
}

const TODO_TOOLS = new Set(["TodoWrite", "TaskCreate", "TaskUpdate"]);
const FILE_KEYS = ["file_path", "path", "notebook_path", "filePath"];

function basename(p: string): string {
  return p.split("/").pop() ?? p;
}

function fileArg(input: Record<string, unknown>): string | undefined {
  for (const k of FILE_KEYS) {
    const v = input[k];
    if (typeof v === "string" && v) return v;
  }
  return undefined;
}

export function deriveLiveActivity(events: AgentEvent[]): LiveActivity | null {
  const open = new Map<string, { toolName: string; input: Record<string, unknown> }>();
  const order: string[] = [];
  for (const ev of events) {
    if (ev.eventType === EventType.ToolCallStart) {
      const p = ev.payload as unknown as Record<string, unknown>;
      const toolName = typeof p.toolName === "string" ? p.toolName : "";
      const toolUseId = typeof p.toolUseId === "string" ? p.toolUseId : "";
      if (!toolUseId || TODO_TOOLS.has(toolName) || toolName.endsWith("thinkrail_visualize")) continue;
      open.set(toolUseId, { toolName, input: (p.toolInput ?? {}) as Record<string, unknown> });
      order.push(toolUseId);
    } else if (ev.eventType === EventType.ToolCallEnd) {
      const p = ev.payload as unknown as Record<string, unknown>;
      const toolUseId = typeof p.toolUseId === "string" ? p.toolUseId : "";
      if (toolUseId) open.delete(toolUseId);
    }
  }
  for (let i = order.length - 1; i >= 0; i--) {
    const entry = open.get(order[i]);
    if (!entry) continue;
    const file = fileArg(entry.input);
    return { toolName: entry.toolName, file, text: file ? `${entry.toolName} · ${basename(file)}` : entry.toolName };
  }
  return null;
}

interface MutItem { key: string; subject: string; activeForm: string; status: string }

export function deriveTaskSnapshot(events: AgentEvent[], status: SessionStatus): TaskSnapshot {
  let byId = new Map<string, MutItem>();
  let order: string[] = [];
  let createCounter = 0;

  for (const ev of events) {
    if (ev.eventType !== EventType.ToolCallStart) continue;
    const p = ev.payload as unknown as Record<string, unknown>;
    const toolName = p.toolName;
    const input = (p.toolInput ?? {}) as Record<string, unknown>;

    if (toolName === "TodoWrite") {
      const raw = input.todos;
      if (!Array.isArray(raw)) continue;
      byId = new Map();
      order = [];
      (raw as Record<string, unknown>[]).forEach((t, i) => {
        const key = String((t.id as string) ?? (t.content as string) ?? `idx${i}`);
        byId.set(key, { key, subject: (t.content as string) ?? "", activeForm: "", status: (t.status as string) ?? "pending" });
        order.push(key);
      });
    } else if (toolName === "TaskCreate") {
      createCounter += 1;
      const key = String(createCounter);
      byId.set(key, {
        key,
        subject: typeof input.subject === "string" ? input.subject : "",
        activeForm: typeof input.activeForm === "string" ? input.activeForm : "",
        status: "pending",
      });
      order.push(key);
    } else if (toolName === "TaskUpdate") {
      const key = typeof input.taskId === "string" ? input.taskId : "";
      if (!key) continue;
      let item = byId.get(key);
      if (!item) { item = { key, subject: "", activeForm: "", status: "pending" }; byId.set(key, item); order.push(key); }
      const s = typeof input.status === "string" ? input.status : "";
      if (s === "deleted") { byId.delete(key); order = order.filter((k) => k !== key); continue; }
      if (s === "pending" || s === "in_progress" || s === "completed") item.status = s;
      if (typeof input.subject === "string") item.subject = input.subject;
      if (typeof input.activeForm === "string") item.activeForm = input.activeForm;
    }
  }

  const items: TaskSnapshotItem[] = order
    .map((k) => byId.get(k))
    .filter((it): it is MutItem => !!it)
    .map((it) => ({
      key: it.key,
      content: it.status === "in_progress" && it.activeForm ? it.activeForm : it.subject,
      status: (it.status === "in_progress" || it.status === "completed" ? it.status : "pending"),
    }));

  const running = isStreaming(status);
  const done = items.filter((i) => i.status === "completed").length;
  let activity: LiveActivity | null = null;
  if (running) {
    activity = deriveLiveActivity(events);
    if (!activity) {
      const ip = items.find((i) => i.status === "in_progress");
      if (ip) activity = { toolName: "", text: ip.content };
    }
  }

  return { items, done, total: items.length, activity, running };
}

export function useTaskSnapshot(sessionId: string | undefined): TaskSnapshot {
  const session = useSessionStore((s) => (sessionId ? s.sessions.get(sessionId) : undefined));
  const events = session?.events;
  const status = session?.status ?? SessionStatus.Done;
  return useMemo(() => deriveTaskSnapshot(events ?? [], status), [events, status]);
}
