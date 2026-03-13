import type { AgentConfig, AgentEvent, Question } from "./agent.ts";

export type SessionStatus = "idle" | "running" | "waiting" | "done" | "error" | "interrupted";

export interface TurnUsage {
  turnIndex: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  totalContextTokens: number; // input + output (context window occupancy)
  costUsd: number;
  timestamp: number;
  /** Number of SDK internal turns (tool-use loops) within this turnComplete. */
  sdkTurns: number;
}

export interface ContextUsage {
  contextMax: number;
  contextTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  inputTokens: number;
  turnHistory: TurnUsage[];
  /** Indices into turnHistory where a new session run (resume) began. */
  runBoundaries: number[];
  toolCallCounts: Record<string, number>;
  toolTokens: Record<string, { inputTokens: number; outputTokens: number }>;
  filesRead: string[];
  filesWritten: string[];
}

export interface SessionMetrics {
  costUsd: number;
  turns: number;
  toolCalls: number;
  contextTokens: number;
  contextMax: number;
  durationMs: number;
  filesChanged: Record<string, "created" | "modified" | "deleted">;
  contextUsage: ContextUsage;
}

export interface PendingRequest {
  requestId: string;
  type: "question" | "approval" | "suggestion";
  // Question fields
  questions?: Question[];
  // Approval fields
  toolName?: string;
  toolInput?: Record<string, unknown>;
  // Suggestion fields
  skill?: string;
  specIds?: string[];
  name?: string;
  reason?: string;
  prompt?: string;
}

export interface Session {
  bonsaiSid: string;
  name: string;
  skillId: string | null;
  specIds: string[];
  status: SessionStatus;
  model: string;
  permissionMode: string;
  betas: string[];
  effort: string | null;
  startedAt: number;
  events: AgentEvent[];
  metrics: SessionMetrics;
  pendingRequest: PendingRequest | null;
  /** Maps requestId → the response that was sent (for rendering answered state) */
  answeredRequests: Map<string, unknown>;
  /** True if this session was loaded from disk (read-only, no live backend runner) */
  restored?: boolean;
  /** The system prompt sent to the agent at session start */
  systemPrompt?: string;
}

export interface ArchivedSession {
  bonsaiSid: string;
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
