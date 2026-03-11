import type { RpcClient } from "../client.ts";
import type { AgentTask, AgentRunParams } from "../types.ts";

export function createAgentApi(client: RpcClient) {
  return {
    run: (params: AgentRunParams) =>
      client.request<{ bonsaiSid: string }>("agent/run", params),

    status: (bonsaiSid: string) =>
      client.request<AgentTask>("agent/status", { bonsaiSid }),

    list: () => client.request<AgentTask[]>("agent/list"),

    send: (bonsaiSid: string, text: string, isMarkdown?: boolean) =>
      client.request<null>("agent/send", { bonsaiSid, text, ...(isMarkdown ? { isMarkdown } : {}) }),

    end: (bonsaiSid: string) =>
      client.request<null>("agent/end", { bonsaiSid }),

    interrupt: (bonsaiSid: string) =>
      client.request<null>("agent/interrupt", { bonsaiSid }),

    respond: (bonsaiSid: string, requestId: string, response: unknown) =>
      client.request<null>("agent/respond", { bonsaiSid, requestId, response }),

    updateConfig: (bonsaiSid: string, config: { model?: string; permissionMode?: string; betas?: string[]; effort?: string | null }) =>
      client.request<{ model: string; permissionMode: string; betas: string[]; effort: string | null }>("agent/updateConfig", { bonsaiSid, ...config }),

    transcribe: (audioBase64: string, mimeType: string) =>
      client.request<{ text: string }>("agent/transcribe", { audioBase64, mimeType }),
  };
}

export type AgentApi = ReturnType<typeof createAgentApi>;
