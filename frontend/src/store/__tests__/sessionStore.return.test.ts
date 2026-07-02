import { describe, it, expect, beforeEach } from "vitest";
import { useSessionStore } from "../sessionStore.ts";
import { useAnswerDraftStore } from "../answerDraftStore.ts";
import { useInputDraftStore } from "../inputDraftStore.ts";
import type { Session } from "@/types/session.ts";

function fakeSession(sid: string, extra: Partial<Session> = {}): Session {
  return {
    thinkrailSid: sid, name: sid, status: "idle", events: [],
    pendingRequests: [], answeredRequests: new Map(),
    parentThinkrailSid: null, subsessionType: null, subsessionContext: null,
    subsessionOrigin: null, returnStatus: null, returnSummary: null,
    ...extra,
  } as unknown as Session;
}

function seed(parentPending: boolean): void {
  const parent = fakeSession("parent", {
    status: "waiting",
    pendingRequests: (parentPending
      ? [{ requestId: "req-9", type: "question" }]
      : []) as unknown as Session["pendingRequests"],
  });
  const child = fakeSession("child", {
    parentThinkrailSid: "parent", subsessionType: "discussion", status: "idle",
  });
  useSessionStore.setState({
    sessions: new Map([["parent", parent], ["child", child]]),
    openTabs: new Set(["parent", "child"]),
    activeSessionId: "child",
  });
}

function returned(origin: unknown): void {
  useSessionStore.getState().onSubsessionReturned({
    parentThinkrailSid: "parent", childThinkRailSid: "child", childName: "Discuss",
    type: "discussion", summary: "use keychain", origin,
  });
}

describe("sessionStore.onSubsessionReturned — discussion routing + lifecycle", () => {
  beforeEach(() => {
    useSessionStore.setState({
      sessions: new Map(), openTabs: new Set(), closedIds: new Set(),
      archivedSessions: [], sessionList: [], activeSessionId: null,
    });
    useAnswerDraftStore.setState({ drafts: new Map() });
    useInputDraftStore.setState({ drafts: new Map() });
  });

  it("routes a question-origin return into the Other answer draft", () => {
    seed(true);
    returned({ kind: "question", requestId: "req-9", questionIndex: 0 });

    expect(useAnswerDraftStore.getState().getDraft("req-9")).toBe("use keychain");
    expect(useInputDraftStore.getState().getDraft("parent")).toBe("");
    const s = useSessionStore.getState();
    expect(s.activeSessionId).toBe("parent");
    expect(s.openTabs.has("child")).toBe(false);
    const parent = s.sessions.get("parent")!;
    expect(
      parent.events.some(
        (e) => (e.payload as { type?: string })?.type === "subsessionResult",
      ),
    ).toBe(true);
  });

  it("routes a message-origin return into the parent message box", () => {
    seed(false);
    returned({ kind: "message" });

    expect(useInputDraftStore.getState().getDraft("parent")).toBe("use keychain");
    expect(useAnswerDraftStore.getState().getDraft("req-9")).toBeUndefined();
    expect(useSessionStore.getState().activeSessionId).toBe("parent");
    expect(useSessionStore.getState().openTabs.has("child")).toBe(false);
  });

  it("falls back to the message box when the question is no longer pending", () => {
    seed(false); // parent has no pending req-9
    returned({ kind: "question", requestId: "req-9", questionIndex: 0 });

    expect(useInputDraftStore.getState().getDraft("parent")).toBe("use keychain");
    expect(useAnswerDraftStore.getState().getDraft("req-9")).toBeUndefined();
  });

  it("returnWithoutResult posts a 'no result' note, switches to parent, closes child", () => {
    seed(false);
    useSessionStore.getState().returnWithoutResult("child");

    const s = useSessionStore.getState();
    expect(s.activeSessionId).toBe("parent");
    expect(s.openTabs.has("child")).toBe(false);
    // No result carried back.
    expect(useInputDraftStore.getState().getDraft("parent")).toBe("");
    // A quiet system note lands in the parent chat.
    const parent = s.sessions.get("parent")!;
    expect(
      parent.events.some((e) =>
        String((e.payload as { message?: string })?.message ?? "").includes("no result returned"),
      ),
    ).toBe(true);
  });
});
