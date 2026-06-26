import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SessionSummary } from "@/api/methods/sessions.ts";

const list = vi.fn<() => Promise<SessionSummary[]>>();

vi.mock("@/api/index.ts", () => ({
  getClient: () => ({}),
}));
vi.mock("@/api/methods/sessions.ts", () => ({
  createSessionApi: () => ({ list }),
}));

import { useSessionStore } from "../sessionStore.ts";

function fakeSummary(sid: string): SessionSummary {
  return { thinkrailSid: sid, name: sid, status: "done", active: false } as unknown as SessionSummary;
}

describe("sessionStore.refreshSessionList", () => {
  beforeEach(() => {
    list.mockReset();
    useSessionStore.setState({ sessionList: [], deletedIds: new Set() });
  });

  it("drops entries the user already deleted (stale list response can't resurrect them)", async () => {
    // Simulate the race: a slower list response still includes a session the
    // user deleted by id in the meantime.
    useSessionStore.setState({ deletedIds: new Set(["gone"]) });
    list.mockResolvedValue([fakeSummary("gone"), fakeSummary("keep")]);

    await useSessionStore.getState().refreshSessionList();

    expect(useSessionStore.getState().sessionList.map((e) => e.thinkrailSid)).toEqual(["keep"]);
  });

  it("keeps all entries when nothing is deleted", async () => {
    list.mockResolvedValue([fakeSummary("a"), fakeSummary("b")]);

    await useSessionStore.getState().refreshSessionList();

    expect(useSessionStore.getState().sessionList.map((e) => e.thinkrailSid)).toEqual(["a", "b"]);
  });
});
