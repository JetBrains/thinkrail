import { describe, it, expect, beforeEach } from "vitest";
import { useSessionStore } from "../sessionStore.ts";

describe("sessionStore remote events", () => {
  beforeEach(() => {
    useSessionStore.setState({ sessions: new Map(), closedIds: new Set() });
  });

  describe("onRemoteSessionCreated", () => {
    it("creates a new session when it does not exist", () => {
      useSessionStore.getState().onRemoteSessionCreated({
        bonsaiSid: "sid1",
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

    it("updates existing session metadata", () => {
      // Pre-populate a session
      useSessionStore.getState().onRemoteSessionCreated({
        bonsaiSid: "sid1",
        name: "Original",
        config: {},
      });

      // Update with new metadata
      useSessionStore.getState().onRemoteSessionCreated({
        bonsaiSid: "sid1",
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

    it("defaults name to truncated bonsaiSid when not provided", () => {
      useSessionStore.getState().onRemoteSessionCreated({
        bonsaiSid: "abcdef1234567890",
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
        bonsaiSid: "sid1",
        name: "Test",
        config: {},
      });

      useSessionStore.getState().onRemoteUserMessage({
        bonsaiSid: "sid1",
        text: "Hello from another client",
        isMarkdown: false,
        sentBy: "Bob",
      });

      const session = useSessionStore.getState().sessions.get("sid1");
      expect(session!.events).toHaveLength(1);
      expect(session!.events[0].eventType).toBe("userMessage");
      expect(session!.events[0].payload.text).toBe("Hello from another client");
    });

    it("deduplicates messages with same text as last event", () => {
      useSessionStore.getState().onRemoteSessionCreated({
        bonsaiSid: "sid1",
        name: "Test",
        config: {},
      });

      // First message
      useSessionStore.getState().onRemoteUserMessage({
        bonsaiSid: "sid1",
        text: "Hello",
      });

      // Same message again (simulating dedup)
      useSessionStore.getState().onRemoteUserMessage({
        bonsaiSid: "sid1",
        text: "Hello",
      });

      const session = useSessionStore.getState().sessions.get("sid1");
      expect(session!.events).toHaveLength(1);
    });

    it("does not dedup when text differs", () => {
      useSessionStore.getState().onRemoteSessionCreated({
        bonsaiSid: "sid1",
        name: "Test",
        config: {},
      });

      useSessionStore.getState().onRemoteUserMessage({
        bonsaiSid: "sid1",
        text: "Hello",
      });

      useSessionStore.getState().onRemoteUserMessage({
        bonsaiSid: "sid1",
        text: "World",
      });

      const session = useSessionStore.getState().sessions.get("sid1");
      expect(session!.events).toHaveLength(2);
    });

    it("ignores messages for unknown sessions", () => {
      useSessionStore.getState().onRemoteUserMessage({
        bonsaiSid: "unknown",
        text: "Hello",
      });

      // Should not crash, session map unchanged
      expect(useSessionStore.getState().sessions.size).toBe(0);
    });
  });
});
