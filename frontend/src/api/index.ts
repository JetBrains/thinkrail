export { RpcClient, type RpcClientOptions } from "./client.ts";
import type { RpcClient as RpcClientType } from "./client.ts";

let _client: RpcClientType | null = null;

export function setClient(client: RpcClientType): void {
  _client = client;
  // Dev-only debug hook so you can manually resolve a stuck pending request
  // from DevTools when a card fails to render:
  //   window.__thinkrailClient.notify("agent/respond", {
  //     thinkrailSid, requestId, response: { behavior: "deny", discuss: false }
  //   })
  if (typeof window !== "undefined" && import.meta.env.DEV) {
    (window as unknown as { __thinkrailClient?: RpcClientType }).__thinkrailClient = client;
  }
}

export function getClient(): RpcClientType {
  if (!_client) throw new Error("RpcClient not initialized — call setClient() first");
  return _client;
}
export { RpcError, RpcTimeoutError, RpcConnectionError, toRpcError } from "./errors.ts";
export { createSpecApi, createAgentApi, type SpecApi, type AgentApi } from "./methods/index.ts";
export { RpcProvider, useRpc, useConnectionState } from "./hooks/useRpc.tsx";
export type {
  Unsubscribe,
  CreateSpecParams,
  AgentRunParams,
} from "./types.ts";
