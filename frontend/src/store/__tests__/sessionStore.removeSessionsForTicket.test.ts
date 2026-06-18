import { describe, it, expect, beforeEach } from "vitest";
import { useSessionStore } from "../sessionStore.ts";
import type { Session } from "@/types/session.ts";
import type { SessionSummary } from "@/api/methods/sessions.ts";

function fakeSession(sid: string, ticketId: string | null): Session {
  return { thinkrailSid: sid, ticketId, name: sid, status: "running", events: [] } as unknown as Session;
}

function fakeSummary(sid: string, ticketId: string | null): SessionSummary {
  return { thinkrailSid: sid, ticketId, name: sid, status: "running", active: true } as unknown as SessionSummary;
}

describe("sessionStore.removeSessionsForTicket", () => {
  beforeEach(() => {
    useSessionStore.setState({
      sessions: new Map(),
      openTabs: new Set(),
      closedIds: new Set(),
      sessionList: [],
      activeSessionId: null,
    });
  });

  it("drops sessions, tabs, and list entries that belong to the ticket", () => {
    useSessionStore.setState({
      sessions: new Map([
        ["orch", fakeSession("orch", "mt_1")],
        ["step", fakeSession("step", "mt_1")],
        ["other", fakeSession("other", "mt_2")],
        ["solo", fakeSession("solo", null)],
      ]),
      openTabs: new Set(["orch", "other", "solo"]),
      sessionList: [
        fakeSummary("orch", "mt_1"),
        fakeSummary("step", "mt_1"),
        fakeSummary("other", "mt_2"),
        fakeSummary("solo", null),
      ],
      activeSessionId: "orch",
    });

    useSessionStore.getState().removeSessionsForTicket("mt_1");

    const s = useSessionStore.getState();
    expect([...s.sessions.keys()].sort()).toEqual(["other", "solo"]);
    expect([...s.openTabs].sort()).toEqual(["other", "solo"]);
    expect(s.sessionList.map((e) => e.thinkrailSid).sort()).toEqual(["other", "solo"]);
    // Removed sessions are marked closed so late-arriving events can't revive them.
    expect(s.closedIds.has("orch")).toBe(true);
    expect(s.closedIds.has("step")).toBe(true);
    // Active session belonged to the deleted ticket → cleared.
    expect(s.activeSessionId).toBeNull();
  });

  it("removes a list-only session even when it isn't in the in-memory map", () => {
    useSessionStore.setState({
      sessions: new Map(),
      sessionList: [fakeSummary("ghost", "mt_x"), fakeSummary("keep", "mt_y")],
    });

    useSessionStore.getState().removeSessionsForTicket("mt_x");

    expect(useSessionStore.getState().sessionList.map((e) => e.thinkrailSid)).toEqual(["keep"]);
  });

  it("leaves the active session untouched when it belongs to another ticket", () => {
    useSessionStore.setState({
      sessions: new Map([
        ["a", fakeSession("a", "mt_1")],
        ["b", fakeSession("b", "mt_2")],
      ]),
      openTabs: new Set(["a", "b"]),
      activeSessionId: "b",
    });

    useSessionStore.getState().removeSessionsForTicket("mt_1");

    expect(useSessionStore.getState().activeSessionId).toBe("b");
    expect(useSessionStore.getState().sessions.has("b")).toBe(true);
  });

  it("is a no-op when no session references the ticket", () => {
    useSessionStore.setState({
      sessions: new Map([["a", fakeSession("a", "mt_1")]]),
      openTabs: new Set(["a"]),
      sessionList: [fakeSummary("a", "mt_1")],
      activeSessionId: "a",
    });

    useSessionStore.getState().removeSessionsForTicket("mt_absent");

    const s = useSessionStore.getState();
    expect(s.sessions.has("a")).toBe(true);
    expect(s.activeSessionId).toBe("a");
    expect(s.closedIds.size).toBe(0);
  });
});
