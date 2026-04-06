import type { RpcClient } from "../client.ts";

export interface SessionSummary {
  bonsaiSid: string;
  name: string;
  skillId?: string;
  specIds: string[];
  status: string;
  model?: string;
  createdAt: string;
  updatedAt: string;
  metrics?: Record<string, unknown>;
  active?: boolean;
  /** Present for draft sessions — full config object */
  config?: Record<string, unknown>;
  /** Present for draft sessions — assembled system prompt */
  systemPrompt?: string;
  /** Present for draft sessions — user's session prompt */
  sessionPrompt?: string;
}

export interface SessionData {
  bonsaiSid: string;
  name: string;
  skillId?: string;
  specIds: string[];
  filePaths?: string[];
  config: Record<string, unknown>;
  status: string;
  sessionId?: string;
  createdAt: string;
  updatedAt: string;
  events: Record<string, unknown>[];
  metrics?: Record<string, unknown>;
}

export function createSessionApi(client: RpcClient) {
  return {
    list: () => client.request<SessionSummary[]>("session/list"),

    get: (bonsaiSid: string) =>
      client.request<SessionData | null>("session/get", { bonsaiSid }),

    continue: (bonsaiSid: string) =>
      client.request<{ bonsaiSid: string }>("session/continue", { bonsaiSid }),

    restart: (bonsaiSid: string) =>
      client.request<{ bonsaiSid: string }>("session/restart", { bonsaiSid }),

    delete: (bonsaiSid: string) =>
      client.request<boolean>("session/delete", { bonsaiSid }),
  };
}

export type SessionApi = ReturnType<typeof createSessionApi>;
