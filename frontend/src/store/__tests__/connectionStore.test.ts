import { describe, it, expect, beforeEach } from "vitest";
import { useConnectionStore, type ConnectedClient } from "../connectionStore.ts";

describe("connectionStore", () => {
  beforeEach(() => {
    useConnectionStore.setState({ clients: [] });
  });

  it("starts with empty clients list", () => {
    expect(useConnectionStore.getState().clients).toEqual([]);
  });

  it("onClientJoin adds a client", () => {
    const client: ConnectedClient = {
      connId: "c1",
      userId: "alice",
      displayName: "Alice",
      connectedAt: 1000,
    };
    useConnectionStore.getState().onClientJoin(client);
    expect(useConnectionStore.getState().clients).toHaveLength(1);
    expect(useConnectionStore.getState().clients[0].connId).toBe("c1");
  });

  it("onClientJoin deduplicates by connId", () => {
    const client: ConnectedClient = {
      connId: "c1",
      userId: "alice",
      displayName: "Alice",
      connectedAt: 1000,
    };
    useConnectionStore.getState().onClientJoin(client);
    useConnectionStore.getState().onClientJoin(client);
    expect(useConnectionStore.getState().clients).toHaveLength(1);
  });

  it("onClientLeave removes the matching client", () => {
    const c1: ConnectedClient = { connId: "c1", userId: "alice", displayName: "Alice", connectedAt: 1000 };
    const c2: ConnectedClient = { connId: "c2", userId: "bob", displayName: "Bob", connectedAt: 2000 };
    useConnectionStore.getState().onClientJoin(c1);
    useConnectionStore.getState().onClientJoin(c2);
    expect(useConnectionStore.getState().clients).toHaveLength(2);

    useConnectionStore.getState().onClientLeave("c1");
    const remaining = useConnectionStore.getState().clients;
    expect(remaining).toHaveLength(1);
    expect(remaining[0].connId).toBe("c2");
  });

  it("onClientLeave with unknown connId is a no-op", () => {
    const c1: ConnectedClient = { connId: "c1", userId: "alice", displayName: "Alice", connectedAt: 1000 };
    useConnectionStore.getState().onClientJoin(c1);
    useConnectionStore.getState().onClientLeave("nonexistent");
    expect(useConnectionStore.getState().clients).toHaveLength(1);
  });
});
