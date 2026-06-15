import { describe, it, expect } from "vitest";
import { collectRunningStageSessions } from "@/components/TicketDetail/TicketDetail.tsx";
import type { WorkNode } from "@/types/rpc-methods.ts";

describe("collectRunningStageSessions", () => {
  it("returns empty set for empty stages", () => {
    expect(collectRunningStageSessions([])).toEqual(new Set());
  });

  it("includes sessionId of a running node whose latest run is session-kind", () => {
    const node: WorkNode = {
      id: "n1",
      title: "Stage 1",
      status: "running",
      runs: [{ kind: "session", sessionId: "sid-abc", status: "running" }],
    };
    const result = collectRunningStageSessions([node]);
    expect(result).toEqual(new Set(["sid-abc"]));
  });

  it("excludes a pending node", () => {
    const node: WorkNode = {
      id: "n2",
      title: "Stage 2",
      status: "pending",
      runs: [{ kind: "session", sessionId: "sid-xyz" }],
    };
    expect(collectRunningStageSessions([node])).toEqual(new Set());
  });

  it("excludes a done node", () => {
    const node: WorkNode = {
      id: "n3",
      title: "Stage 3",
      status: "done",
      runs: [{ kind: "session", sessionId: "sid-done" }],
    };
    expect(collectRunningStageSessions([node])).toEqual(new Set());
  });

  it("excludes a running node whose latest run is subagent-kind", () => {
    const node: WorkNode = {
      id: "n4",
      title: "Stage 4",
      status: "running",
      runs: [{ kind: "subagent", sessionId: "sid-sub" }],
    };
    expect(collectRunningStageSessions([node])).toEqual(new Set());
  });

  it("excludes a running node with no sessionId on the latest run", () => {
    const node: WorkNode = {
      id: "n5",
      title: "Stage 5",
      status: "running",
      runs: [{ kind: "session" }],
    };
    expect(collectRunningStageSessions([node])).toEqual(new Set());
  });

  it("excludes a running node with no runs", () => {
    const node: WorkNode = {
      id: "n6",
      title: "Stage 6",
      status: "running",
      runs: [],
    };
    expect(collectRunningStageSessions([node])).toEqual(new Set());
  });

  it("uses only the latest run to determine kind/sessionId", () => {
    const node: WorkNode = {
      id: "n7",
      title: "Stage 7",
      status: "running",
      runs: [
        { kind: "session", sessionId: "sid-old" },
        { kind: "subagent", sessionId: "sid-sub" },
      ],
    };
    expect(collectRunningStageSessions([node])).toEqual(new Set());
  });

  it("recurses into children", () => {
    const child: WorkNode = {
      id: "c1",
      title: "Child",
      status: "running",
      runs: [{ kind: "session", sessionId: "sid-child" }],
    };
    const parent: WorkNode = {
      id: "p1",
      title: "Parent",
      status: "pending",
      children: [child],
    };
    expect(collectRunningStageSessions([parent])).toEqual(new Set(["sid-child"]));
  });

  it("collects sessions from multiple running nodes", () => {
    const a: WorkNode = {
      id: "a",
      title: "A",
      status: "running",
      runs: [{ kind: "session", sessionId: "sid-a" }],
    };
    const b: WorkNode = {
      id: "b",
      title: "B",
      status: "running",
      runs: [{ kind: "session", sessionId: "sid-b" }],
    };
    const c: WorkNode = {
      id: "c",
      title: "C",
      status: "done",
      runs: [{ kind: "session", sessionId: "sid-c" }],
    };
    expect(collectRunningStageSessions([a, b, c])).toEqual(new Set(["sid-a", "sid-b"]));
  });
});
