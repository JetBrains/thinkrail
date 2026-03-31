import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RpcClient } from "../client.ts";

// ── Minimal WebSocket mock ──

type WsHandler = ((ev: unknown) => void) | null;

class MockWebSocket {
  static instances: MockWebSocket[] = [];

  onopen: WsHandler = null;
  onclose: WsHandler = null;
  onerror: WsHandler = null;
  onmessage: WsHandler = null;
  readyState = 0; // CONNECTING
  url: string;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  close() {
    this.readyState = 3; // CLOSED
    this.onclose?.({ code: 1006, reason: "" });
  }

  send(_data: string) {}
}

// ── Tests ──

describe("RpcClient connection timeout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    MockWebSocket.instances = [];
    vi.stubGlobal("WebSocket", MockWebSocket);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("closes the socket and retries if onopen does not fire within connectTimeout", async () => {
    const client = new RpcClient("ws://localhost:8000/ws", {
      connectTimeout: 3000,
      reconnectBackoff: [100],
    });

    const states: string[] = [];
    client.onStateChange((s) => states.push(s));

    // Start connection — don't await, it will be rejected by the timeout
    const connectPromise = client.connect().catch(() => {});

    // WebSocket created but onopen never fires
    expect(MockWebSocket.instances).toHaveLength(1);
    expect(states).toEqual(["connecting"]);

    // Advance past the connectTimeout
    vi.advanceTimersByTime(3000);

    // The timeout should have closed the socket, triggering onclose → reconnecting
    await vi.advanceTimersByTimeAsync(0); // flush microtasks
    await connectPromise;

    expect(MockWebSocket.instances[0].readyState).toBe(3); // CLOSED
    expect(states).toContain("reconnecting");
  });

  it("does not time out when onopen fires before the deadline", async () => {
    const client = new RpcClient("ws://localhost:8000/ws", {
      connectTimeout: 3000,
    });

    const connectPromise = client.connect();

    // Simulate immediate connection success
    const ws = MockWebSocket.instances[0];
    ws.readyState = 1;
    ws.onopen!({});

    await connectPromise;
    expect(client.state).toBe("connected");

    // Advance past the timeout — nothing should happen
    vi.advanceTimersByTime(5000);
    expect(client.state).toBe("connected");
  });

  it("clears the connect timer on manual disconnect", async () => {
    const client = new RpcClient("ws://localhost:8000/ws", {
      connectTimeout: 3000,
    });

    client.connect().catch(() => {});
    expect(MockWebSocket.instances).toHaveLength(1);

    // Disconnect before timeout fires
    client.disconnect();
    expect(client.state).toBe("disconnected");

    // Advance past the timeout — should NOT create a new socket or change state
    vi.advanceTimersByTime(5000);
    expect(client.state).toBe("disconnected");
    expect(MockWebSocket.instances).toHaveLength(1);
  });
});

describe("RpcClient unlimited reconnection", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    MockWebSocket.instances = [];
    vi.stubGlobal("WebSocket", MockWebSocket);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("retries beyond the old 3-attempt limit with default options", async () => {
    const client = new RpcClient("ws://localhost:8000/ws", {
      connectTimeout: 100,
      reconnectBackoff: [50, 100, 150],
    });

    client.connect().catch(() => {});

    // Fail through 5 cycles (more than the old limit of 3)
    for (let i = 0; i < 5; i++) {
      // Timeout fires → close → reconnecting → backoff → new connect
      vi.advanceTimersByTime(100); // connectTimeout
      await vi.advanceTimersByTimeAsync(0); // flush
      vi.advanceTimersByTime(150); // backoff (capped at last value)
      await vi.advanceTimersByTimeAsync(0); // flush
    }

    // Should still be trying, not "failed"
    expect(client.state).not.toBe("failed");
    // Should have created 6 WebSocket instances (1 initial + 5 retries)
    expect(MockWebSocket.instances.length).toBeGreaterThanOrEqual(6);
  });

  it("backoff caps at the last value in the array", async () => {
    const client = new RpcClient("ws://localhost:8000/ws", {
      connectTimeout: 50,
      reconnectBackoff: [100, 200, 300],
    });

    client.connect().catch(() => {});

    // Burn through first 3 backoff values
    for (let i = 0; i < 3; i++) {
      vi.advanceTimersByTime(50);
      await vi.advanceTimersByTimeAsync(0);
      vi.advanceTimersByTime(300);
      await vi.advanceTimersByTimeAsync(0);
    }

    const countBefore = MockWebSocket.instances.length;

    // 4th attempt should use 300ms (capped), not undefined
    vi.advanceTimersByTime(50); // timeout
    await vi.advanceTimersByTimeAsync(0);

    // Advance only 200ms — should NOT have reconnected yet (backoff is 300)
    vi.advanceTimersByTime(200);
    await vi.advanceTimersByTimeAsync(0);
    expect(MockWebSocket.instances.length).toBe(countBefore);

    // Advance remaining 100ms — NOW it should reconnect
    vi.advanceTimersByTime(100);
    await vi.advanceTimersByTimeAsync(0);
    expect(MockWebSocket.instances.length).toBe(countBefore + 1);
  });
});
