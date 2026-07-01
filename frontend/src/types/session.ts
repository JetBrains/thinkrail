import type { AgentConfig, AgentEvent, Question, SessionArtifact } from "./agent.ts";
import type { TicketActionState, SessionReturnStatus, SessionStatus } from "@/constants/status.ts";

export type { SessionStatus };

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
  /** The turn currently in flight, updated live from costEstimate. Null
   *  between turns; appended to turnHistory once the turn completes. Its
   *  costUsd is an estimate (rendered with a ~ prefix). */
  liveTurn?: TurnUsage | null;
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
  type: "question" | "approval" | "suggestion" | "statement" | "description-suggestion" | "step-proposal";
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
  // Statement fields
  statement?: string;
  // Description suggestion fields
  description?: string;
  section?: string;
  // Step proposal fields
  ticketId?: string;
  stepNumber?: number;
  stepTitle?: string;
  inputSpecIds?: string[];
}

// ── Session outcome — done-screen contract from the agent ───────────────
// Mirrors backend/app/agent/models.py: OutcomeArtifact, OutcomeAction (union),
// SessionOutcome. Update both ends together.

export interface OutcomeArtifact {
  path: string;
  label?: string | null;
  openOnDone?: boolean;
}

export interface CreateTicketAction {
  type: "create_ticket";
  id: string;
  title: string;
  body?: string | null;
  state: TicketActionState;
}

export interface StartSessionAction {
  type: "start_session";
  id: string;
  title: string;
  description?: string | null;
  skillId: string;
  prompt?: string | null;
  primary?: boolean;
}

export interface NavigateAction {
  type: "navigate";
  id: string;
  title: string;
  description?: string | null;
  target: "board" | "specs" | "graph" | "files";
}

export type OutcomeAction = CreateTicketAction | StartSessionAction | NavigateAction;

export interface SessionOutcome {
  summary?: string | null;
  artifacts: OutcomeArtifact[];
  actions: OutcomeAction[];
}

/** Where a discussion subsession was launched from, so its return can land in
 *  the right place in the parent: a pending question's "Other" field, or the
 *  message box. Mirrors backend `SubsessionOrigin`. */
export interface SubsessionOrigin {
  kind: "question" | "message";
  requestId?: string | null;
  questionIndex?: number;
}

export interface Session {
  thinkrailSid: string;
  name: string;
  skillId: string | null;
  specIds: string[];
  filePaths: string[];
  status: SessionStatus;
  model: string;
  permissionMode: string;
  effort: string;
  /** Runtime-declared option toggles, keyed by RuntimeFlag.key. */
  flags?: Record<string, boolean>;
  startedAt: number;
  events: AgentEvent[];
  metrics: SessionMetrics;
  /** Outstanding requests awaiting user response (approval / question /
   *  suggestion / step-proposal). Today most flows produce at most one
   *  entry, but ticket-implement's subagent-gated mode emits multiple
   *  suggest_step cards concurrently when the plan permits parallelism. */
  pendingRequests: PendingRequest[];
  /** ticket-implement orchestrator only. Picks how plan steps are
   *  dispatched. See `.tr/design_docs/TICKET_LIFECYCLE_DESIGN.md`
   *  § Implementation orchestration modes. */
  subagentMode?: "step-session" | "subagent";
  /** Only meaningful when subagentMode === "subagent". */
  stepGate?: "approve" | "autonomous";
  /** Maps requestId → the response that was sent (for rendering answered state) */
  answeredRequests: Map<string, unknown>;
  /** Associated meta-ticket ID (persists across session lifecycle) */
  ticketId?: string | null;
  /** Who created this session (display name from auth identity) */
  createdBy?: string;
  /** True if this session was loaded from disk (read-only, no live backend runner) */
  restored?: boolean;
  /** The system prompt sent to the agent at session start */
  systemPrompt?: string;
  /** Structured prompt sections for the preview UI */
  promptSections?: PromptSection[] | null;
  /** Frontend-only draft that has no backend task yet. Layers on
   *  `status: "draft"`; never sent to or stored by the backend. */
  unsaved?: boolean;
  /** True once the user renamed the draft by hand — freezes live name
   *  derivation from the prompt. */
  nameManuallySet?: boolean;
  parentThinkrailSid: string | null;
  subsessionType: "discussion" | "refinement" | null;
  subsessionContext: string | null;
  subsessionOrigin: SubsessionOrigin | null;
  /** Identifies how the session was created. "stage-default" sessions are
   *  auto-spawned by the ticket view for the ticket's current phase. The
   *  Discard control is hidden for these — the UI created them, not the user. */
  kind?: "stage-default";
  returnStatus: SessionReturnStatus | null;
  returnSummary: string | null;
  /** Done-screen contract emitted by the skill via SessionFinalize tool */
  outcome?: SessionOutcome | null;
  /** Per-session artifact list — files written/edited/proposed during this
   *  session. Ticket-linked only; empty otherwise. Mirrors AgentTask.artifacts. */
  artifacts: SessionArtifact[];
  /** Currently-focused artifact path, or null. Mirrors AgentTask.preview_path. */
  previewPath: string | null;
  /** One-shot scroll-to-section anchor from the latest SetPreviewFile call.
   *  Not persisted on the task — applied once per preview-body load. */
  previewSection: string | null;
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
  thinkrailSid: string;
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
