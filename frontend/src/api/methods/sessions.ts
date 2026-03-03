import type { RpcClient } from "../client.ts";

export interface SessionSummary {
  taskId: string;
  name: string;
  skillId?: string;
  specIds: string[];
  status: string;
  model?: string;
  createdAt: string;
  updatedAt: string;
  metrics?: Record<string, unknown>;
  active?: boolean;
  continuedFrom?: string;
}

export interface SessionData {
  taskId: string;
  name: string;
  skillId?: string;
  specIds: string[];
  config: Record<string, unknown>;
  status: string;
  sessionId?: string;
  createdAt: string;
  updatedAt: string;
  events: Record<string, unknown>[];
  continuedFrom?: string;
}

export function createSessionApi(client: RpcClient) {
  return {
    list: () => client.request<SessionSummary[]>("session/list"),

    get: (taskId: string) =>
      client.request<SessionData | null>("session/get", { taskId }),

    continue: (taskId: string) =>
      client.request<{ taskId: string }>("session/continue", { taskId }),

    delete: (taskId: string) =>
      client.request<boolean>("session/delete", { taskId }),
  };
}

export type SessionApi = ReturnType<typeof createSessionApi>;
