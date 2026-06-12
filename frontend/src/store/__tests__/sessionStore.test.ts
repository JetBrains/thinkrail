import { describe, it, expect, beforeEach } from "vitest";
import { useSessionStore } from "../sessionStore.ts";

describe("sessionStore remote events", () => {
  beforeEach(() => {
    useSessionStore.setState({ sessions: new Map(), closedIds: new Set() });
  });

  describe("onRemoteSessionCreated", () => {
    it("creates a new session when it does not exist", () => {
      useSessionStore.getState().onRemoteSessionCreated({
        thinkrailSid: "sid1",
        name: "Test Session",
        skillId: null,
        specIds: ["s1"],
        filePaths: [],
        status: "draft",
        config: { model: "claude-opus-4-6", permissionMode: "default" },
        createdBy: "Alice",
      });

      const session = useSessionStore.getState().sessions.get("sid1");
      expect(session).toBeDefined();
      expect(session!.name).toBe("Test Session");
      expect(session!.createdBy).toBe("Alice");
      expect(session!.specIds).toEqual(["s1"]);
      expect(session!.model).toBe("claude-opus-4-6");
    });

    it("hydrates subagentMode and stepGate from the remote payload", () => {
      // Regression: Phase G UX testing caught the case where the dropdown
      // reverted to defaults after page reload because the hydration paths
      // dropped these fields on the floor.
      useSessionStore.getState().onRemoteSessionCreated({
        thinkrailSid: "sid-mode",
        name: "Modal",
        skillId: "ticket-implement",
        status: "draft",
        config: { model: "claude-sonnet-4-6" },
        subagentMode: "subagent",
        stepGate: "autonomous",
      });
      const session = useSessionStore.getState().sessions.get("sid-mode");
      expect(session).toBeDefined();
      expect(session!.subagentMode).toBe("subagent");
      expect(session!.stepGate).toBe("autonomous");
    });

    it("defaults subagentMode/stepGate to undefined when remote omits them", () => {
      useSessionStore.getState().onRemoteSessionCreated({
        thinkrailSid: "sid-nomode",
        name: "NoMode",
        config: {},
      });
      const session = useSessionStore.getState().sessions.get("sid-nomode");
      expect(session!.subagentMode).toBeUndefined();
      expect(session!.stepGate).toBeUndefined();
    });

    it("updates existing session metadata", () => {
      // Pre-populate a session
      useSessionStore.getState().onRemoteSessionCreated({
        thinkrailSid: "sid1",
        name: "Original",
        config: {},
      });

      // Update with new metadata
      useSessionStore.getState().onRemoteSessionCreated({
        thinkrailSid: "sid1",
        name: "Updated",
        status: "running",
        config: { model: "claude-sonnet-4-6" },
        createdBy: "Bob",
      });

      const session = useSessionStore.getState().sessions.get("sid1");
      expect(session!.name).toBe("Updated");
      expect(session!.model).toBe("claude-sonnet-4-6");
      expect(session!.createdBy).toBe("Bob");
    });

    it("defaults name to truncated thinkrailSid when not provided", () => {
      useSessionStore.getState().onRemoteSessionCreated({
        thinkrailSid: "abcdef1234567890",
        config: {},
      });

      const session = useSessionStore.getState().sessions.get("abcdef1234567890");
      expect(session!.name).toBe("abcdef12");
    });
  });

  describe("onRemoteUserMessage", () => {
    it("appends a user message event", () => {
      // Create a session first
      useSessionStore.getState().onRemoteSessionCreated({
        thinkrailSid: "sid1",
        name: "Test",
        config: {},
      });

      useSessionStore.getState().onRemoteUserMessage({
        thinkrailSid: "sid1",
        text: "Hello from another client",
        isMarkdown: false,
        sentBy: "Bob",
      });

      const session = useSessionStore.getState().sessions.get("sid1");
      expect(session!.events).toHaveLength(1);
      expect(session!.events[0].eventType).toBe("userMessage");
      expect((session!.events[0].payload as { text?: string }).text).toBe("Hello from another client");
    });

    it("deduplicates messages with same text as last event", () => {
      useSessionStore.getState().onRemoteSessionCreated({
        thinkrailSid: "sid1",
        name: "Test",
        config: {},
      });

      // First message
      useSessionStore.getState().onRemoteUserMessage({
        thinkrailSid: "sid1",
        text: "Hello",
      });

      // Same message again (simulating dedup)
      useSessionStore.getState().onRemoteUserMessage({
        thinkrailSid: "sid1",
        text: "Hello",
      });

      const session = useSessionStore.getState().sessions.get("sid1");
      expect(session!.events).toHaveLength(1);
    });

    it("does not dedup when text differs", () => {
      useSessionStore.getState().onRemoteSessionCreated({
        thinkrailSid: "sid1",
        name: "Test",
        config: {},
      });

      useSessionStore.getState().onRemoteUserMessage({
        thinkrailSid: "sid1",
        text: "Hello",
      });

      useSessionStore.getState().onRemoteUserMessage({
        thinkrailSid: "sid1",
        text: "World",
      });

      const session = useSessionStore.getState().sessions.get("sid1");
      expect(session!.events).toHaveLength(2);
    });

    it("ignores messages for unknown sessions", () => {
      useSessionStore.getState().onRemoteUserMessage({
        thinkrailSid: "unknown",
        text: "Hello",
      });

      // Should not crash, session map unchanged
      expect(useSessionStore.getState().sessions.size).toBe(0);
    });
  });

  describe("patchSessionInList", () => {
    beforeEach(() => {
      useSessionStore.setState({
        sessionList: [
          {
            thinkrailSid: "sidA",
            name: "Alpha",
            specIds: [],
            status: "idle",
            createdAt: "2026-01-01T00:00:00Z",
            updatedAt: "2026-01-01T00:00:00Z",
          },
          {
            thinkrailSid: "sidB",
            name: "Bravo",
            specIds: [],
            status: "draft",
            createdAt: "2026-01-01T00:00:00Z",
            updatedAt: "2026-01-01T00:00:00Z",
          },
        ],
      });
    });

    it("updates the matching session's fields and replaces the array reference", () => {
      const before = useSessionStore.getState().sessionList;
      useSessionStore.getState().patchSessionInList("sidA", { status: "running" });
      const after = useSessionStore.getState().sessionList;

      expect(after).not.toBe(before);
      expect(after[0].status).toBe("running");
      // Untouched entries keep object identity.
      expect(after[1]).toBe(before[1]);
    });

    it("is a no-op when the thinkrailSid is not in the list", () => {
      const before = useSessionStore.getState().sessionList;
      useSessionStore.getState().patchSessionInList("does-not-exist", { status: "done" });
      const after = useSessionStore.getState().sessionList;

      expect(after).toBe(before);
    });

    it("only writes the fields in the patch — leaves the rest intact", () => {
      useSessionStore.getState().patchSessionInList("sidB", { status: "initializing" });
      const entry = useSessionStore.getState().sessionList[1];

      expect(entry.status).toBe("initializing");
      expect(entry.name).toBe("Bravo");
      expect(entry.thinkrailSid).toBe("sidB");
    });
  });
});

import { selectProposeChangesByFile } from "../sessionStore.ts";
import type { Session } from "@/types/session.ts";

function makePcSession(
  events: { eventType: string; payload: Record<string, unknown> }[],
  answered: Record<string, unknown> = {},
): Session {
  return {
    thinkrailSid: "s1",
    events,
    answeredRequests: new Map(Object.entries(answered)),
  } as unknown as Session;
}

describe("selectProposeChangesByFile", () => {
  it("returns empty map when no events", () => {
    const result = selectProposeChangesByFile(makePcSession([]));
    expect(result.size).toBe(0);
  });

  it("groups proposeChange events by filePath in event order", () => {
    const events = [
      { eventType: "proposeChange", payload: { requestId: "r1", filePath: "a.md", oldString: "x", newString: "y" } },
      { eventType: "proposeChange", payload: { requestId: "r2", filePath: "b.md", oldString: "u", newString: "v" } },
      { eventType: "proposeChange", payload: { requestId: "r3", filePath: "a.md", oldString: "p", newString: "q" } },
    ];
    const result = selectProposeChangesByFile(makePcSession(events));
    expect(Array.from(result.keys())).toEqual(["a.md", "b.md"]);
    expect(result.get("a.md")!.map((h) => h.requestId)).toEqual(["r1", "r3"]);
    expect(result.get("b.md")!.map((h) => h.requestId)).toEqual(["r2"]);
  });

  it("marks resolved hunks with their resolution", () => {
    const events = [
      { eventType: "proposeChange", payload: { requestId: "r1", filePath: "a.md", oldString: "x", newString: "y" } },
    ];
    const answered = { r1: { behavior: "allow", applied: "original" } };
    const result = selectProposeChangesByFile(makePcSession(events, answered));
    const h = result.get("a.md")![0];
    expect(h.state).toBe("accepted");
    expect(h.resolution).toEqual({ behavior: "allow", applied: "original" });
  });

  it("marks deny+discuss as rejected (with feedback retained)", () => {
    const events = [
      { eventType: "proposeChange", payload: { requestId: "r1", filePath: "a.md", oldString: "x", newString: "y" } },
    ];
    const answered = { r1: { behavior: "deny", discuss: true, feedback: "wrong angle" } };
    const result = selectProposeChangesByFile(makePcSession(events, answered));
    const h = result.get("a.md")![0];
    expect(h.state).toBe("rejected");
    expect(h.resolution).toEqual({ behavior: "deny", discuss: true, feedback: "wrong angle" });
  });
});
