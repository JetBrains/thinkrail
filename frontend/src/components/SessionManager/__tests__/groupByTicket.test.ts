import { describe, it, expect } from "vitest";
import type { SessionSummary } from "@/api/methods/sessions.ts";
import { groupByTicket, pickFocusSession } from "../groupByTicket.ts";

function mk(overrides: Partial<SessionSummary>): SessionSummary {
  return {
    bonsaiSid: "s",
    name: "n",
    specIds: [],
    status: "idle",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("groupByTicket", () => {
  it("collapses multiple sessions of the same ticket into one group", () => {
    const out = groupByTicket([
      mk({ bonsaiSid: "a", ticketId: "t1", updatedAt: "2026-01-03T00:00:00Z" }),
      mk({ bonsaiSid: "b", ticketId: "t1", updatedAt: "2026-01-02T00:00:00Z" }),
      mk({ bonsaiSid: "c", ticketId: "t1", updatedAt: "2026-01-01T00:00:00Z" }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("ticket");
    if (out[0].kind === "ticket") {
      expect(out[0].sessions.map((s) => s.bonsaiSid)).toEqual(["a", "b", "c"]);
      expect(out[0].latestActivity).toBe("2026-01-03T00:00:00Z");
    }
  });

  it("keeps standalone sessions ungrouped", () => {
    const out = groupByTicket([
      mk({ bonsaiSid: "solo", ticketId: null, updatedAt: "2026-01-03T00:00:00Z" }),
      mk({ bonsaiSid: "a", ticketId: "t1", updatedAt: "2026-01-02T00:00:00Z" }),
    ]);
    expect(out.map((e) => e.kind)).toEqual(["session", "ticket"]);
  });

  it("orders mixed groups + standalones by latest activity", () => {
    const out = groupByTicket([
      mk({ bonsaiSid: "a", ticketId: "t1", updatedAt: "2026-01-05T00:00:00Z" }),
      mk({ bonsaiSid: "solo1", updatedAt: "2026-01-06T00:00:00Z" }),
      mk({ bonsaiSid: "b", ticketId: "t2", updatedAt: "2026-01-04T00:00:00Z" }),
      mk({ bonsaiSid: "solo2", updatedAt: "2026-01-03T00:00:00Z" }),
    ]);
    expect(out.map((e) => (e.kind === "ticket" ? `t:${e.ticketId}` : `s:${e.session.bonsaiSid}`)))
      .toEqual(["s:solo1", "t:t1", "t:t2", "s:solo2"]);
  });

  it("counts running and attention-needing sessions per group", () => {
    const out = groupByTicket([
      mk({ bonsaiSid: "a", ticketId: "t1", status: "running" }),
      mk({ bonsaiSid: "b", ticketId: "t1", status: "waiting" }),
      mk({ bonsaiSid: "c", ticketId: "t1", status: "error" }),
      mk({ bonsaiSid: "d", ticketId: "t1", status: "done" }),
    ]);
    if (out[0].kind === "ticket") {
      expect(out[0].runningCount).toBe(1);
      expect(out[0].attentionCount).toBe(2); // waiting + error
    }
  });
});

describe("pickFocusSession", () => {
  it("prefers waiting/error over running over latest", () => {
    const group = groupByTicket([
      mk({ bonsaiSid: "old", ticketId: "t1", status: "done", updatedAt: "2026-01-01T00:00:00Z" }),
      mk({ bonsaiSid: "run", ticketId: "t1", status: "running", updatedAt: "2026-01-02T00:00:00Z" }),
      mk({ bonsaiSid: "wait", ticketId: "t1", status: "waiting", updatedAt: "2026-01-03T00:00:00Z" }),
    ])[0];
    if (group.kind === "ticket") {
      expect(pickFocusSession(group).bonsaiSid).toBe("wait");
    }
  });

  it("falls back to running when no attention", () => {
    const group = groupByTicket([
      mk({ bonsaiSid: "done", ticketId: "t1", status: "done", updatedAt: "2026-01-01T00:00:00Z" }),
      mk({ bonsaiSid: "run", ticketId: "t1", status: "running", updatedAt: "2026-01-02T00:00:00Z" }),
    ])[0];
    if (group.kind === "ticket") {
      expect(pickFocusSession(group).bonsaiSid).toBe("run");
    }
  });

  it("falls back to most recent when no attention or running", () => {
    const group = groupByTicket([
      mk({ bonsaiSid: "older", ticketId: "t1", status: "done", updatedAt: "2026-01-01T00:00:00Z" }),
      mk({ bonsaiSid: "newer", ticketId: "t1", status: "idle", updatedAt: "2026-01-02T00:00:00Z" }),
    ])[0];
    if (group.kind === "ticket") {
      expect(pickFocusSession(group).bonsaiSid).toBe("newer");
    }
  });
});
