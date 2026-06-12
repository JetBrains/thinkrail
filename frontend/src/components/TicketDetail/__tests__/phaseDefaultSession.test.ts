import { describe, it, expect } from "vitest";
import { resolvePhaseDefaultSid } from "@/components/TicketDetail/phaseDefaultSession.ts";
import type { Ticket } from "@/types/board.ts";
import type { Session, ArchivedSession } from "@/types/session.ts";
import type { SessionSummary } from "@/api/methods/sessions.ts";

function makeTicket(o: Partial<Ticket> = {}): Ticket {
  return {
    id: "t1",
    title: "x",
    status: "implementing",
    sessionIds: [],
    ...o,
  } as unknown as Ticket;
}

function liveSession(o: Partial<Session>): Session {
  return {
    thinkrailSid: "s",
    skillId: null,
    status: "idle",
    startedAt: 0,
    ...o,
  } as unknown as Session;
}

function archived(o: Partial<ArchivedSession>): ArchivedSession {
  return {
    thinkrailSid: "s",
    skillId: null,
    startedAt: 0,
    endedAt: 0,
    result: "done",
    ...o,
  } as unknown as ArchivedSession;
}

function summary(o: Partial<SessionSummary>): SessionSummary {
  return {
    thinkrailSid: "s",
    status: "idle",
    updatedAt: "1970-01-01T00:00:00Z",
    ...o,
  } as unknown as SessionSummary;
}

const IMPLEMENT = "ticket-implement";

describe("resolvePhaseDefaultSid", () => {
  it("returns null for a null ticket", () => {
    expect(resolvePhaseDefaultSid(null, new Map(), [], new Map())).toBeNull();
  });

  it("returns null when the current phase has no skill (idea/done)", () => {
    const t = makeTicket({ status: "idea", sessionIds: ["a"] });
    const live = new Map([["a", liveSession({ thinkrailSid: "a", skillId: IMPLEMENT })]]);
    expect(resolvePhaseDefaultSid(t, live, [], new Map())).toBeNull();
  });

  it("returns null when no attached session matches the phase skill", () => {
    const t = makeTicket({ status: "implementing", sessionIds: ["a"] });
    const live = new Map([
      ["a", liveSession({ thinkrailSid: "a", skillId: "ticket-product-design" })],
    ]);
    expect(resolvePhaseDefaultSid(t, live, [], new Map())).toBeNull();
  });

  it("matches a live phase session", () => {
    const t = makeTicket({ status: "implementing", sessionIds: ["a"] });
    const live = new Map([["a", liveSession({ thinkrailSid: "a", skillId: IMPLEMENT })]]);
    expect(resolvePhaseDefaultSid(t, live, [], new Map())).toBe("a");
  });

  it("prefers a worked-on session over an orphan draft", () => {
    const t = makeTicket({ status: "implementing", sessionIds: ["draft", "worked"] });
    const live = new Map([
      ["draft", liveSession({ thinkrailSid: "draft", skillId: IMPLEMENT, status: "draft", startedAt: 100 })],
      ["worked", liveSession({ thinkrailSid: "worked", skillId: IMPLEMENT, status: "done", startedAt: 1 })],
    ]);
    expect(resolvePhaseDefaultSid(t, live, [], new Map())).toBe("worked");
  });

  it("orders non-draft matches by descending timestamp", () => {
    const t = makeTicket({ status: "implementing", sessionIds: ["old", "new"] });
    const live = new Map([
      ["old", liveSession({ thinkrailSid: "old", skillId: IMPLEMENT, status: "done", startedAt: 10 })],
      ["new", liveSession({ thinkrailSid: "new", skillId: IMPLEMENT, status: "done", startedAt: 20 })],
    ]);
    expect(resolvePhaseDefaultSid(t, live, [], new Map())).toBe("new");
  });

  it("resolves skill/status from archived sessions when not live", () => {
    const t = makeTicket({ status: "implementing", sessionIds: ["a"] });
    const arch = [archived({ thinkrailSid: "a", skillId: IMPLEMENT, endedAt: 5 })];
    expect(resolvePhaseDefaultSid(t, new Map(), arch, new Map())).toBe("a");
  });

  it("resolves skill/status from summaries when neither live nor archived", () => {
    const t = makeTicket({ status: "implementing", sessionIds: ["a"] });
    const sums = new Map([["a", summary({ thinkrailSid: "a", skillId: IMPLEMENT, status: "done" })]]);
    expect(resolvePhaseDefaultSid(t, new Map(), [], sums)).toBe("a");
  });
});
