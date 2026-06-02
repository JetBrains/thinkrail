import { describe, it, expect } from "vitest";
import { deriveSessionTodoState } from "@/components/TicketDetail/sessionTodoState.ts";
import type { AgentEvent } from "@/types/agent.ts";

function toolCall(toolName: string, toolInput: Record<string, unknown>): AgentEvent {
  return {
    eventType: "toolCallStart",
    payload: { toolName, toolUseId: `t_${Math.random()}`, toolInput },
  } as unknown as AgentEvent;
}

describe("deriveSessionTodoState", () => {
  it("returns null when there are no task events", () => {
    expect(deriveSessionTodoState([])).toBeNull();
    expect(
      deriveSessionTodoState([toolCall("Read", { file_path: "x.md" })]),
    ).toBeNull();
  });

  // ── TodoWrite (legacy) protocol ─────────────────────────────────────

  it("captures a TodoWrite full-list emission", () => {
    const snap = deriveSessionTodoState([
      toolCall("TodoWrite", {
        todos: [
          { id: "a", content: "First", status: "in_progress" },
          { id: "b", content: "Second", status: "pending" },
        ],
      }),
    ])!;
    expect(snap.todos).toEqual([
      { key: "a", content: "First", status: "in_progress" },
      { key: "b", content: "Second", status: "pending" },
    ]);
  });

  it("later TodoWrite replaces earlier (full-list semantics)", () => {
    const snap = deriveSessionTodoState([
      toolCall("TodoWrite", {
        todos: [{ id: "a", content: "First", status: "in_progress" }],
      }),
      toolCall("TodoWrite", {
        todos: [{ id: "a", content: "First", status: "completed" }],
      }),
    ])!;
    expect(snap.todos[0]).toMatchObject({ key: "a", status: "completed" });
  });

  // ── TaskCreate / TaskUpdate protocol (SDK 0.2.83+ default) ──────────

  it("captures TaskCreate events with sequential ids", () => {
    const snap = deriveSessionTodoState([
      toolCall("TaskCreate", { subject: "First", activeForm: "Doing first" }),
      toolCall("TaskCreate", { subject: "Second" }),
    ])!;
    expect(snap.todos).toEqual([
      { key: "1", content: "First", status: "pending" },
      { key: "2", content: "Second", status: "pending" },
    ]);
  });

  it("TaskUpdate flips status by taskId", () => {
    const snap = deriveSessionTodoState([
      toolCall("TaskCreate", { subject: "First" }),
      toolCall("TaskCreate", { subject: "Second" }),
      toolCall("TaskUpdate", { taskId: "1", status: "in_progress" }),
      toolCall("TaskUpdate", { taskId: "1", status: "completed" }),
    ])!;
    expect(snap.todos[0]).toMatchObject({ key: "1", status: "completed" });
    expect(snap.todos[1]).toMatchObject({ key: "2", status: "pending" });
  });

  it("uses activeForm as content when status is in_progress", () => {
    const snap = deriveSessionTodoState([
      toolCall("TaskCreate", { subject: "Draft section: Goal", activeForm: "Drafting Goal" }),
      toolCall("TaskUpdate", { taskId: "1", status: "in_progress" }),
    ])!;
    expect(snap.todos[0].content).toBe("Drafting Goal");
  });

  it("falls back to subject when in_progress but no activeForm", () => {
    const snap = deriveSessionTodoState([
      toolCall("TaskCreate", { subject: "Examine context" }),
      toolCall("TaskUpdate", { taskId: "1", status: "in_progress" }),
    ])!;
    expect(snap.todos[0].content).toBe("Examine context");
  });

  it("TaskUpdate with status=deleted removes the task", () => {
    const snap = deriveSessionTodoState([
      toolCall("TaskCreate", { subject: "First" }),
      toolCall("TaskCreate", { subject: "Second" }),
      toolCall("TaskUpdate", { taskId: "1", status: "deleted" }),
    ])!;
    expect(snap.todos.map((t) => t.key)).toEqual(["2"]);
  });

  it("touchByKey records the event index of the last status change", () => {
    const snap = deriveSessionTodoState([
      toolCall("TaskCreate", { subject: "First" }), // idx 0
      toolCall("TaskUpdate", { taskId: "1", status: "in_progress" }), // idx 1
      toolCall("Read", { file_path: "x.md" }), // idx 2 — non-task
      toolCall("TaskUpdate", { taskId: "1", status: "completed" }), // idx 3
    ])!;
    expect(snap.touchByKey.get("1")).toBe(3);
  });

  // ── Real-world fixture — mirror of the demo-board session ──

  it("handles the 12-create + in_progress / completed sequence", () => {
    const titles = [
      "Examine context",
      "Ask clarifying questions",
      "Update ticket description",
      "Write document skeleton",
      "Draft section: Goal",
      "Draft section: User stories",
    ];
    const events: AgentEvent[] = [
      ...titles.map((subject) =>
        toolCall("TaskCreate", { subject, activeForm: `Doing ${subject}` }),
      ),
      toolCall("TaskUpdate", { taskId: "1", status: "in_progress" }),
      toolCall("TaskUpdate", { taskId: "1", status: "completed" }),
      toolCall("TaskUpdate", { taskId: "2", status: "in_progress" }),
    ];
    const snap = deriveSessionTodoState(events)!;
    expect(snap.todos).toHaveLength(6);
    expect(snap.todos[0]).toMatchObject({ key: "1", status: "completed", content: "Examine context" });
    expect(snap.todos[1]).toMatchObject({ key: "2", status: "in_progress", content: "Doing Ask clarifying questions" });
    expect(snap.todos[2]).toMatchObject({ key: "3", status: "pending" });
  });
});
