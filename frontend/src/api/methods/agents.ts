import type { RpcClient } from "../client.ts";
import type { AgentTask, AgentRunParams, AgentConfig } from "../types.ts";

export interface DraftUpdateParams {
  bonsaiSid: string;
  specIds?: string[];
  filePaths?: string[];
  skillId?: string | null;
  config?: AgentConfig;
  prompt?: string | null;
  name?: string;
  metaTicketId?: string | null;
}

export function createAgentApi(client: RpcClient) {
  return {
    run: (params: AgentRunParams) =>
      client.request<{ bonsaiSid: string }>("agent/run", params),

    prepare: (params: AgentRunParams) =>
      client.request<{ bonsaiSid: string; systemPrompt: string; sections?: unknown[]; totalTokens?: number }>("agent/prepare", params),

    updateDraft: (params: DraftUpdateParams) =>
      client.request<{ systemPrompt: string; sections?: unknown[]; totalTokens?: number }>("agent/updateDraft", params),

    startDraft: (bonsaiSid: string, prompt?: string) =>
      client.request<{ bonsaiSid: string }>("agent/startDraft", { bonsaiSid, ...(prompt !== undefined ? { prompt } : {}) }),

    status: (bonsaiSid: string) =>
      client.request<AgentTask>("agent/status", { bonsaiSid }),

    list: () => client.request<AgentTask[]>("agent/list"),

    send: (bonsaiSid: string, text: string, isMarkdown?: boolean) =>
      client.request<null>("agent/send", { bonsaiSid, text, ...(isMarkdown ? { isMarkdown } : {}) }),

    retryLastMessage: (bonsaiSid: string) =>
      client.request<{ ok: boolean }>("agent/retryLastMessage", { bonsaiSid }),

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
