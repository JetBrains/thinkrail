import type { RpcClient } from "../client.ts";
import type { AgentTask, AgentRunParams } from "../types.ts";

export function createAgentApi(client: RpcClient) {
  return {
    run: (params: AgentRunParams) =>
      client.request<{ taskId: string }>("agent/run", params),

    status: (taskId: string) =>
      client.request<AgentTask>("agent/status", { taskId }),

    list: () => client.request<AgentTask[]>("agent/list"),

    send: (taskId: string, text: string) =>
      client.request<null>("agent/send", { taskId, text }),

    end: (taskId: string) =>
      client.request<null>("agent/end", { taskId }),

    interrupt: (taskId: string) =>
      client.request<null>("agent/interrupt", { taskId }),

    respond: (taskId: string, requestId: string, response: unknown) =>
      client.request<null>("agent/respond", { taskId, requestId, response }),

    updateConfig: (taskId: string, config: { model?: string; permissionMode?: string }) =>
      client.request<{ model: string; permissionMode: string }>("agent/updateConfig", { taskId, ...config }),
  };
}

export type AgentApi = ReturnType<typeof createAgentApi>;
