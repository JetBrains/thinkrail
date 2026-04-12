import type { AgentConfig, AgentEvent, Question } from "./agent.ts";

export type SessionStatus = "draft" | "initializing" | "idle" | "running" | "waiting" | "done" | "error" | "interrupted";

/** Token usage for a single API call within a turn (one "iteration"). */
export interface IterationUsage {
  type: "message" | "compaction";
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  cacheCreation?: {
    ephemeral5mInputTokens: number;
    ephemeral1hInputTokens: number;
  };
}

export interface TurnUsage {
  turnIndex: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  totalContextTokens: number; // last iteration: input + cache + output
  costUsd: number;
  timestamp: number;
  /** Number of SDK internal turns (tool-use loops) within this turnComplete. */
  sdkTurns: number;
  /** Per-API-call token breakdown within this turn. */
  iterations?: IterationUsage[];
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
  type: "question" | "approval" | "suggestion" | "description-suggestion" | "step-proposal";
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
  // Description suggestion fields
  description?: string;
  section?: string;
  // Step proposal fields
  ticketId?: string;
  stepNumber?: number;
  stepTitle?: string;
  inputSpecIds?: string[];
}

export interface Session {
  bonsaiSid: string;
  name: string;
  skillId: string | null;
  specIds: string[];
  filePaths: string[];
  status: SessionStatus;
  model: string;
  permissionMode: string;
  betas: string[];
  effort: string | null;
  maxTurns: number;
  startedAt: number;
  events: AgentEvent[];
  metrics: SessionMetrics;
  pendingRequest: PendingRequest | null;
  /** Maps requestId → the response that was sent (for rendering answered state) */
  answeredRequests: Map<string, unknown>;
  /** Associated meta-ticket ID (persists across session lifecycle) */
  metaTicketId?: string | null;
  /** Who created this session (display name from auth identity) */
  createdBy?: string;
  /** True if this session was loaded from disk (read-only, no live backend runner) */
  restored?: boolean;
  /** The system prompt sent to the agent at session start */
  systemPrompt?: string;
  /** Structured prompt sections for the preview UI */
  promptSections?: PromptSection[] | null;
}

export interface PromptSection {
  key: string;
  label: string;
  content: string;
  tokens: number;
  specDetails?: { id: string; title: string; content: string; tokens: number }[];
  fileDetails?: { path: string; name: string; preview: string; tokens: number }[];
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
