import type { RpcClient } from "../client.ts";
import type { AgentTask, AgentRunParams } from "../types.ts";

export function createAgentApi(client: RpcClient) {
  return {
    run: (params: AgentRunParams) =>
      client.request<{ taskId: string }>("agent/run", params),

    status: (taskId: string) =>
      client.request<AgentTask>("agent/status", { taskId }),

    list: () => client.request<AgentTask[]>("agent/list"),

    interrupt: (taskId: string) =>
      client.request<null>("agent/interrupt", { taskId }),

    respond: (taskId: string, requestId: string, response: unknown) =>
      client.request<null>("agent/respond", { taskId, requestId, response }),
  };
}

export type AgentApi = ReturnType<typeof createAgentApi>;
