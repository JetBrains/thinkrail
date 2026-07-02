// @vitest-environment jsdom
/**
 * "Apply effort on next message" + seamless config-change restart.
 *
 * Effort can't be changed on a live SDK client (no live set_effort), so
 * changing it stages a relaunch (`pendingRelaunch`) rather than restarting the
 * session immediately — the relaunch folds into the next send, and its
 * transient `agent/done` is suppressed so the session never looks "completed".
 */

import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";

import { setClient } from "@/api/index.ts";
import type { RpcClient } from "@/api/client.ts";
import { useSessionStore } from "../sessionStore.ts";
import { useInputDraftStore } from "../inputDraftStore.ts";
import type { Session } from "@/types/session.ts";

interface StubClient {
  request: Mock;
}

function makeStubClient(
  routes: Record<string, (params: Record<string, unknown>) => unknown> = {},
): StubClient {
  const request = vi.fn(async (method: string, params: Record<string, unknown> = {}) => {
    const handler = routes[method];
    if (handler) return handler(params);
    if (method === "session/restart") return { thinkrailSid: params.thinkrailSid };
    if (method === "agent/updateConfig") {
      return { model: "m", permissionMode: "default", effort: params.effort ?? "auto" };
    }
    return null;
  });
  return { request };
}

const SID = "sess-1";

function metrics() {
  return {
    costUsd: 0, turns: 0, toolCalls: 0, contextTokens: 0, contextMax: 0, durationMs: 0,
    filesChanged: {},
    contextUsage: {
      contextMax: 0, contextTokens: 0, outputTokens: 0, cacheReadTokens: 0,
      cacheCreationTokens: 0, inputTokens: 0, turnHistory: [], runBoundaries: [],
      toolCallCounts: {}, toolTokens: {}, filesRead: [], filesWritten: [],
    },
  };
}

function seedSession(overrides: Partial<Session> = {}): void {
  const session = {
    thinkrailSid: SID,
    name: "S",
    skillId: null,
    specIds: [],
    filePaths: [],
    status: "idle",
    model: "claude-opus-4-8",
    permissionMode: "default",
    effort: "high",
    flags: {},
    startedAt: Date.now(),
    events: [],
    metrics: metrics(),
    pendingRequests: [],
    answeredRequests: new Map(),
    ticketId: null,
    parentThinkrailSid: null,
    ...overrides,
  } as unknown as Session;
  useSessionStore.setState({ sessions: new Map([[SID, session]]), closedIds: new Set() });
}

function methodsCalled(stub: StubClient): string[] {
  return stub.request.mock.calls.map((c) => c[0] as string);
}

beforeEach(() => {
  useSessionStore.setState({ sessions: new Map(), closedIds: new Set() });
  useInputDraftStore.setState({ drafts: new Map() });
});

describe("changeEffort", () => {
  it("persists the effort and stages a relaunch — without restarting", async () => {
    const stub = makeStubClient();
    setClient(stub as unknown as RpcClient);
    seedSession();

    await useSessionStore.getState().changeEffort(SID, "low");

    const cfg = stub.request.mock.calls.find((c) => c[0] === "agent/updateConfig");
    expect(cfg?.[1]).toMatchObject({ effort: "low" });
    expect(methodsCalled(stub)).not.toContain("session/restart");
    expect(useSessionStore.getState().sessions.get(SID)?.pendingRelaunch).toBe(true);
  });
});

describe("sendMessage with a staged config change", () => {
  it("relaunches before sending, then clears the flag", async () => {
    const stub = makeStubClient();
    setClient(stub as unknown as RpcClient);
    seedSession({ pendingRelaunch: true });

    await useSessionStore.getState().sendMessage(SID, "hello");

    const order = methodsCalled(stub);
    expect(order).toContain("session/restart");
    expect(order).toContain("agent/send");
    // Relaunch happens before the message is sent.
    expect(order.indexOf("session/restart")).toBeLessThan(order.indexOf("agent/send"));
    expect(useSessionStore.getState().sessions.get(SID)?.pendingRelaunch).toBe(false);
  });

  it("does not relaunch when nothing is staged", async () => {
    const stub = makeStubClient();
    setClient(stub as unknown as RpcClient);
    seedSession({ pendingRelaunch: false });

    await useSessionStore.getState().sendMessage(SID, "hello");

    expect(methodsCalled(stub)).not.toContain("session/restart");
    expect(methodsCalled(stub)).toContain("agent/send");
  });
});

describe("onSessionDone during a restart", () => {
  it("suppresses the completion without clearing the flag (the later session/didEnd needs it)", () => {
    seedSession({ status: "initializing", restarting: true, events: [] });

    useSessionStore.getState().onSessionDone({ thinkrailSid: SID, costUsd: 0.5, turns: 1 });

    const s = useSessionStore.getState().sessions.get(SID)!;
    expect(s.restarting).toBe(true); // NOT consumed — cleared later on agent/ready
    expect(s.status).toBe("initializing"); // NOT flipped to "done"
    expect(s.events.length).toBe(0); // no agent/done card appended
  });

  it("marks a real completion when not restarting", () => {
    seedSession({ status: "running", restarting: false, events: [] });

    useSessionStore.getState().onSessionDone({ thinkrailSid: SID, costUsd: 0.5, turns: 1 });

    const s = useSessionStore.getState().sessions.get(SID)!;
    expect(s.status).toBe("done");
    expect(s.events.length).toBe(1); // agent/done card appended
  });
});

describe("relaunch goes live", () => {
  it("agent/ready clears the restart guard and returns the session to idle", () => {
    seedSession({ status: "initializing", restarting: true, events: [] });

    useSessionStore.getState().onAgentEvent("agent/ready", { thinkrailSid: SID });

    const s = useSessionStore.getState().sessions.get(SID)!;
    expect(s.restarting).toBe(false);
    expect(s.status).toBe("idle");
  });

  it("a real completion after the relaunch renders normally", () => {
    // restarting cleared by agent/ready → a subsequent done is a real completion.
    seedSession({ status: "initializing", restarting: true, events: [] });
    useSessionStore.getState().onAgentEvent("agent/ready", { thinkrailSid: SID });
    useSessionStore.getState().onSessionDone({ thinkrailSid: SID, costUsd: 1, turns: 2 });

    const s = useSessionStore.getState().sessions.get(SID)!;
    expect(s.status).toBe("done");
    // agent/ready appended one event, then the real done appended another.
    expect(s.events.length).toBe(2);
  });
});

describe("restartSession preserves an in-flight turn's status", () => {
  it("keeps 'running' (no 'initializing' flash) when a turn is in flight", async () => {
    const stub = makeStubClient();
    setClient(stub as unknown as RpcClient);
    seedSession({ status: "running" });

    await useSessionStore.getState().restartSession(SID);

    const s = useSessionStore.getState().sessions.get(SID)!;
    // A turn already in flight keeps running on the old model until it
    // completes; the relaunch applies the new model afterward. Painting
    // "initializing" over a live turn would show it for the whole turn — no
    // event re-asserts "running" mid-turn. The guard is still set so the old
    // run's transient done/didEnd stay suppressed.
    expect(s.status).toBe("running");
    expect(s.restarting).toBe(true);
    expect(methodsCalled(stub)).toContain("session/restart");
  });

  it("shows 'initializing' when restarting a quiescent (idle) session", async () => {
    const stub = makeStubClient();
    setClient(stub as unknown as RpcClient);
    seedSession({ status: "idle" });

    await useSessionStore.getState().restartSession(SID);

    expect(useSessionStore.getState().sessions.get(SID)?.status).toBe("initializing");
    expect(useSessionStore.getState().sessions.get(SID)?.restarting).toBe(true);
  });
});
