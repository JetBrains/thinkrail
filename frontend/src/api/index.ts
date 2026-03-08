export { RpcClient, type RpcClientOptions } from "./client.ts";
import type { RpcClient as RpcClientType } from "./client.ts";

let _client: RpcClientType | null = null;

export function setClient(client: RpcClientType): void {
  _client = client;
}

export function getClient(): RpcClientType {
  if (!_client) throw new Error("RpcClient not initialized — call setClient() first");
  return _client;
}
export { RpcError, RpcTimeoutError, RpcConnectionError, toRpcError } from "./errors.ts";
export { createSpecApi, createAgentApi, type SpecApi, type AgentApi } from "./methods/index.ts";
export { RpcProvider, useRpc, useConnectionState } from "./hooks/useRpc.tsx";
export { useSpecs, useSpec, useGraph } from "./hooks/useSpecs.ts";
export type {
  Unsubscribe,
  CreateSpecParams,
  AgentRunParams,
  CostSummary,
  CostBudget,
} from "./types.ts";
