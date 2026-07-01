import { describe, it, expect } from "vitest";
import { deriveTaskSnapshot, deriveLiveActivity } from "../useTaskSnapshot.ts";
import { SessionStatus } from "@/constants/status.ts";
import type { AgentEvent } from "@/types/agent.ts";

function toolStart(toolName: string, toolUseId: string, toolInput: Record<string, unknown> = {}): AgentEvent {
  return { eventType: "toolCallStart", payload: { toolName, toolUseId, toolInput } } as unknown as AgentEvent;
}
function toolEnd(toolUseId: string): AgentEvent {
  return { eventType: "toolCallEnd", payload: { toolUseId, output: "", isError: false } } as unknown as AgentEvent;
}

describe("deriveTaskSnapshot", () => {
  it("returns empty snapshot when no task events", () => {
    const snap = deriveTaskSnapshot([toolStart("Read", "t1", { file_path: "a.ts" })], SessionStatus.Running);
    expect(snap.items).toEqual([]);
    expect(snap.total).toBe(0);
    expect(snap.done).toBe(0);
  });

  it("aggregates TaskCreate/TaskUpdate into ordered items with counts", () => {
    const events: AgentEvent[] = [
      toolStart("TaskCreate", "c1", { subject: "First", activeForm: "Doing first" }),
      toolStart("TaskCreate", "c2", { subject: "Second" }),
      toolStart("TaskUpdate", "u1", { taskId: "1", status: "completed" }),
      toolStart("TaskUpdate", "u2", { taskId: "2", status: "in_progress", activeForm: "Working second" }),
    ];
    const snap = deriveTaskSnapshot(events, SessionStatus.Running);
    expect(snap.total).toBe(2);
    expect(snap.done).toBe(1);
    expect(snap.items[0]).toMatchObject({ key: "1", content: "First", status: "completed" });
    // in_progress uses activeForm as content
    expect(snap.items[1]).toMatchObject({ key: "2", content: "Working second", status: "in_progress" });
  });

  it("TodoWrite replaces the list", () => {
    const events: AgentEvent[] = [
      toolStart("TaskCreate", "c1", { subject: "stale" }),
      toolStart("TodoWrite", "w1", { todos: [
        { id: "a", content: "Alpha", status: "completed" },
        { id: "b", content: "Beta", status: "pending" },
      ] }),
    ];
    const snap = deriveTaskSnapshot(events, SessionStatus.Running);
    expect(snap.items.map((i) => i.content)).toEqual(["Alpha", "Beta"]);
    expect(snap.done).toBe(1);
  });

  it("running=false and activity=null when session not streaming", () => {
    const events: AgentEvent[] = [toolStart("TaskCreate", "c1", { subject: "x" })];
    const snap = deriveTaskSnapshot(events, SessionStatus.Done);
    expect(snap.running).toBe(false);
    expect(snap.activity).toBeNull();
  });
});

describe("deriveLiveActivity", () => {
  it("returns the last unmatched tool call as tool · file", () => {
    const events: AgentEvent[] = [
      toolStart("Read", "t1", { file_path: "/x/a.ts" }),
      toolEnd("t1"),
      toolStart("Edit", "t2", { file_path: "src/components/ChatStream/ChatStream.tsx" }),
    ];
    const act = deriveLiveActivity(events);
    expect(act).toEqual({ toolName: "Edit", file: "src/components/ChatStream/ChatStream.tsx", text: "Edit · ChatStream.tsx" });
  });

  it("ignores task/todo tools as activity", () => {
    const events: AgentEvent[] = [toolStart("TaskUpdate", "u1", { taskId: "1", status: "in_progress" })];
    expect(deriveLiveActivity(events)).toBeNull();
  });

  it("returns null when all tool calls are finished", () => {
    const events: AgentEvent[] = [toolStart("Read", "t1"), toolEnd("t1")];
    expect(deriveLiveActivity(events)).toBeNull();
  });
});
