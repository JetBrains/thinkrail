import { describe, it, expect } from "vitest";
import { deriveLiveActivity } from "@/hooks/useTaskSnapshot.ts";
import type { AgentEvent } from "@/types/agent.ts";

// SessionSubRow shows the activity line only for the active run; the value
// comes from deriveLiveActivity over the session's events.
describe("SessionSubRow live activity source", () => {
  it("derives the current tool for an active stage session", () => {
    const events: AgentEvent[] = [
      { eventType: "toolCallStart", payload: { toolName: "Edit", toolUseId: "t1", toolInput: { file_path: "src/board/plan.py" } } } as unknown as AgentEvent,
    ];
    expect(deriveLiveActivity(events)).toEqual({ toolName: "Edit", file: "src/board/plan.py", text: "Edit · plan.py" });
  });
});
