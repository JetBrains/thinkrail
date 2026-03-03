import type { ConnectionState } from "@/types/rpc.ts";
import { RpcConnectionError, RpcTimeoutError, toRpcError } from "./errors.ts";
import type { Unsubscribe } from "./types.ts";

export interface RpcClientOptions {
  autoReconnect: boolean;
  maxReconnectAttempts: number;
  reconnectBackoff: number[];
  requestTimeout: number;
}

const DEFAULT_OPTIONS: RpcClientOptions = {
  autoReconnect: true,
  maxReconnectAttempts: 3,
  reconnectBackoff: [1000, 2000, 4000],
  requestTimeout: 30_000,
};

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class RpcClient {
  private url: string;
  private options: RpcClientOptions;
  private ws: WebSocket | null = null;
  private nextId = 1;
  private pending = new Map<number, PendingRequest>();
  private notificationHandlers = new Map<string, Set<(params: unknown) => void>>();
  private requestHandlers = new Map<string, (params: unknown) => Promise<unknown>>();
  private stateListeners = new Set<(state: ConnectionState) => void>();
  private _state: ConnectionState = "disconnected";
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private manualDisconnect = false;

  constructor(url: string, options?: Partial<RpcClientOptions>) {
    this.url = url;
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  get state(): ConnectionState {
    return this._state;
  }

  private setState(state: ConnectionState): void {
    if (this._state === state) return;
    this._state = state;
    this.stateListeners.forEach((cb) => cb(state));
  }

  onStateChange(callback: (state: ConnectionState) => void): Unsubscribe {
    this.stateListeners.add(callback);
    return () => this.stateListeners.delete(callback);
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.ws) {
        this.ws.close();
      }
      this.manualDisconnect = false;
      this.setState("connecting");

      const ws = new WebSocket(this.url);

      ws.onopen = () => {
        this.ws = ws;
        this.reconnectAttempt = 0;
        this.setState("connected");
        resolve();
      };

      ws.onerror = () => {
        if (this._state === "connecting") {
          reject(new RpcConnectionError());
        }
      };

      ws.onclose = (event) => {
        this.ws = null;
        this.rejectAllPending();

        if (this.manualDisconnect) {
          this.setState("disconnected");
          return;
        }

        // Code 4000 = replaced by another connection — don't reconnect
        if (event.code === 4000) {
          this.setState("disconnected");
          return;
        }

        if (this.options.autoReconnect && this.reconnectAttempt < this.options.maxReconnectAttempts) {
          this.scheduleReconnect();
        } else if (this.reconnectAttempt >= this.options.maxReconnectAttempts) {
          this.setState("failed");
        } else {
          this.setState("disconnected");
        }
      };

      ws.onmessage = (event) => {
        this.handleMessage(event.data as string);
      };
    });
  }

  disconnect(): void {
    this.manualDisconnect = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.rejectAllPending();
    this.setState("disconnected");
  }

  async reconnect(): Promise<void> {
    this.reconnectAttempt = 0;
    this.manualDisconnect = false;
    return this.connect();
  }

  request<T>(method: string, params?: object): Promise<T> {
    if (!this.ws || this._state !== "connected") {
      return Promise.reject(new RpcConnectionError());
    }

    const id = this.nextId++;
    const message = JSON.stringify({
      jsonrpc: "2.0",
      id,
      method,
      params: params ?? {},
    });

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new RpcTimeoutError(method));
      }, this.options.requestTimeout);

      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timer,
      });

      this.ws!.send(message);
    });
  }

  notify(method: string, params?: object): void {
    if (!this.ws || this._state !== "connected") return;
    this.ws.send(
      JSON.stringify({ jsonrpc: "2.0", method, params: params ?? {} }),
    );
  }

  on(method: string, handler: (params: unknown) => void): Unsubscribe {
    let handlers = this.notificationHandlers.get(method);
    if (!handlers) {
      handlers = new Set();
      this.notificationHandlers.set(method, handlers);
    }
    handlers.add(handler);
    return () => handlers!.delete(handler);
  }

  onRequest(
    method: string,
    handler: (params: unknown) => Promise<unknown>,
  ): Unsubscribe {
    this.requestHandlers.set(method, handler);
    return () => this.requestHandlers.delete(method);
  }

  // ── Private ──

  private handleMessage(data: string): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }

    const id = msg.id as number | string | undefined;
    const method = msg.method as string | undefined;
    const result = msg.result;
    const error = msg.error as { code: number; message: string; data?: unknown } | undefined;

    // Case 1: Response to our request (success)
    if (id !== undefined && result !== undefined && !method) {
      const pending = this.pending.get(id as number);
      if (pending) {
        clearTimeout(pending.timer);
        pending.resolve(result);
        this.pending.delete(id as number);
      }
      return;
    }

    // Case 2: Error response to our request
    if (id !== undefined && error !== undefined && !method) {
      const pending = this.pending.get(id as number);
      if (pending) {
        clearTimeout(pending.timer);
        pending.reject(toRpcError(error));
        this.pending.delete(id as number);
      }
      return;
    }

    // Case 3: Server-initiated request (has both id and method)
    if (id !== undefined && method !== undefined) {
      const handler = this.requestHandlers.get(method);
      if (handler) {
        handler(msg.params)
          .then((res) => {
            this.ws?.send(
              JSON.stringify({ jsonrpc: "2.0", id, result: res }),
            );
          })
          .catch((err) => {
            this.ws?.send(
              JSON.stringify({
                jsonrpc: "2.0",
                id,
                error: { code: -32603, message: String(err) },
              }),
            );
          });
        return;
      }
      // No onRequest handler — fall through to notification handlers.
      // Supports the pattern where server sends messages with `id` but
      // the response is sent via a separate RPC method (agent/respond).
      const notifHandlers = this.notificationHandlers.get(method);
      if (notifHandlers) {
        notifHandlers.forEach((h) => h(msg.params));
      }
      return;
    }

    // Case 4: Notification (method only, no id)
    if (method !== undefined) {
      const handlers = this.notificationHandlers.get(method);
      if (handlers) {
        handlers.forEach((h) => h(msg.params));
      }
    }
  }

  private scheduleReconnect(): void {
    this.setState("reconnecting");
    const delay =
      this.options.reconnectBackoff[this.reconnectAttempt] ??
      this.options.reconnectBackoff[this.options.reconnectBackoff.length - 1];
    this.reconnectAttempt++;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect().catch(() => {
        // connect() failure triggers onclose, which will schedule next attempt or transition to failed
      });
    }, delay);
  }

  private rejectAllPending(): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new RpcConnectionError());
      this.pending.delete(id);
    }
  }
}
