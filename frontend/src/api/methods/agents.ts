import type { RpcClient } from "../client.ts";
import type { AgentTask, AgentRunParams, AgentConfig } from "../types.ts";

export interface DraftUpdateParams {
  thinkrailSid: string;
  specIds?: string[];
  filePaths?: string[];
  skillId?: string | null;
  config?: AgentConfig;
  prompt?: string | null;
  name?: string;
  /** Draft-on-type: in-progress prompt text persisted as the non-context
   *  `draftInput`. Restored into the input box, never assembled into the
   *  system prompt. */
  draftInput?: string;
  ticketId?: string | null;
  /** ticket-implement only. Picks how the orchestrator dispatches plan
   *  steps. See `.tr/design_docs/TICKET_LIFECYCLE_DESIGN.md`. */
  subagentMode?: "step-session" | "subagent";
  /** Only meaningful when subagentMode === "subagent". */
  stepGate?: "approve" | "autonomous";
}

export function createAgentApi(client: RpcClient) {
  return {
    run: (params: AgentRunParams) =>
      client.request<{ thinkrailSid: string }>("agent/run", params),

    prepare: (params: AgentRunParams & { thinkrailSid?: string; draftInput?: string }) =>
      client.request<{ thinkrailSid: string; systemPrompt: string; sections?: unknown[]; totalTokens?: number }>("agent/prepare", params),

    updateDraft: (params: DraftUpdateParams) =>
      client.request<{ systemPrompt: string; sections?: unknown[]; totalTokens?: number }>("agent/updateDraft", params),

    startDraft: (thinkrailSid: string, prompt?: string) =>
      client.request<{ thinkrailSid: string }>("agent/startDraft", { thinkrailSid, ...(prompt !== undefined ? { prompt } : {}) }),

    status: (thinkrailSid: string) =>
      client.request<AgentTask>("agent/status", { thinkrailSid }),

    list: () => client.request<AgentTask[]>("agent/list"),

    send: (thinkrailSid: string, text: string, isMarkdown?: boolean) =>
      client.request<null>("agent/send", { thinkrailSid, text, ...(isMarkdown ? { isMarkdown } : {}) }),

    retryLastMessage: (thinkrailSid: string) =>
      client.request<{ ok: boolean }>("agent/retryLastMessage", { thinkrailSid }),

    end: (thinkrailSid: string) =>
      client.request<null>("agent/end", { thinkrailSid }),

    interrupt: (thinkrailSid: string) =>
      client.request<null>("agent/interrupt", { thinkrailSid }),

    respond: (thinkrailSid: string, requestId: string, response: unknown) =>
      client.request<null>("agent/respond", { thinkrailSid, requestId, response }),

    updateConfig: (thinkrailSid: string, config: { model?: string; permissionMode?: string; effort?: string }) =>
      client.request<{ model: string; permissionMode: string; effort: string }>("agent/updateConfig", { thinkrailSid, ...config }),

    transcribe: (audioBase64: string, mimeType: string) =>
      client.request<{ text: string }>("agent/transcribe", { audioBase64, mimeType }),
  };
}

export type AgentApi = ReturnType<typeof createAgentApi>;
