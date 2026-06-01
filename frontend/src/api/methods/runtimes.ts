import type { RpcClient } from "../client.ts";
import type { RuntimeType } from "@/types/agent.ts";
import type {
  RuntimeCapabilities,
  RuntimesListResponse,
} from "@/types/rpc-methods.ts";

export function createRuntimesApi(client: RpcClient) {
  return {
    list: () => client.request<RuntimesListResponse>("runtimes/list"),

    capabilities: (runtimeType: RuntimeType) =>
      client.request<RuntimeCapabilities>("runtimes/capabilities", { runtimeType }),
  };
}

export type RuntimesApi = ReturnType<typeof createRuntimesApi>;
