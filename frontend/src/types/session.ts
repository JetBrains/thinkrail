import type { AgentConfig, AgentEvent, Question } from "./agent.ts";

export type SessionStatus = "idle" | "running" | "done" | "error" | "interrupted";

export interface SessionMetrics {
  costUsd: number;
  turns: number;
  toolCalls: number;
  contextTokens: number;
  contextMax: number;
  durationMs: number;
  filesChanged: Record<string, "created" | "modified" | "deleted">;
}

export interface PendingRequest {
  requestId: string;
  type: "question" | "approval";
  questions?: Question[];
  toolName?: string;
  toolInput?: Record<string, unknown>;
}

export interface Session {
  taskId: string;
  name: string;
  skillId: string | null;
  specIds: string[];
  status: SessionStatus;
  model: string;
  permissionMode: string;
  startedAt: number;
  events: AgentEvent[];
  metrics: SessionMetrics;
  pendingRequest: PendingRequest | null;
  /** Maps requestId → the response that was sent (for rendering answered state) */
  answeredRequests: Map<string, unknown>;
  /** True if this session was loaded from disk (read-only, no live backend runner) */
  restored?: boolean;
}

export interface ArchivedSession {
  taskId: string;
  name: string;
  skillId: string | null;
  specIds: string[];
  startedAt: number;
  endedAt: number;
  result: "done" | "error";
  costUsd: number;
  turns: number;
  durationMs: number;
  model: string;
  config: AgentConfig;
  events: AgentEvent[];
}
