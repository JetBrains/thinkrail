/**
 * Agent event types — mirrors backend/app/agent/models.py (camelCase wire format).
 *
 * AgentEvent and all specific event types are auto-generated from the backend
 * Pydantic models. Run `npm run generate:ws-types` to regenerate.
 */

import type {
  Question,
  SessionStartEvent,
  TextDeltaEvent,
  ToolCallStartEvent,
  ToolCallEndEvent,
  SubagentStartEvent,
  SubagentEndEvent,
  CompactEvent,
  ProgressEvent,
  NotificationEvent,
  PermissionDeniedEvent,
  ReadyEvent,
  TurnCompleteEvent,
  InterruptedEvent,
  ErrorEvent,
  DoneEvent,
  AskUserQuestionEvent,
  ConfirmActionEvent,
  SuggestSessionEvent,
  SuggestDescriptionEvent,
  SuggestStepEvent,
  RequestResolvedEvent,
  RequestExpiredEvent,
  UserMessageEvent,
} from "./ws-events.ts";

export type {
  Question,
  SessionStartEvent,
  TextDeltaEvent,
  ToolCallStartEvent,
  ToolCallEndEvent,
  SubagentStartEvent,
  SubagentEndEvent,
  CompactEvent,
  ProgressEvent,
  NotificationEvent,
  PermissionDeniedEvent,
  ReadyEvent,
  TurnCompleteEvent,
  InterruptedEvent,
  ErrorEvent,
  DoneEvent,
  AskUserQuestionEvent,
  ConfirmActionEvent,
  SuggestSessionEvent,
  SuggestDescriptionEvent,
  SuggestStepEvent,
  RequestResolvedEvent,
  RequestExpiredEvent,
  UserMessageEvent,
};

// Re-export generated payload + other types.
export type {
  WsEvents as AgentEvent,
  SessionStartPayload,
  TextDeltaPayload,
  ToolCallStartPayload,
  ToolCallEndPayload,
  TurnCompletePayload,
  InterruptedPayload,
  ErrorPayload,
  AskUserQuestionPayload,
  ConfirmActionPayload,
  SuggestSessionPayload,
  SuggestStepPayload,
  UserMessagePayload,
  QuestionOption,
} from "./ws-events.ts";

export type TaskStatus = "idle" | "running" | "done" | "error";

// ─── Semantic event type groups ───────────────────────────────────────────────
// Derived from the generated event interfaces — strings live only in ws-events.ts.

/** Agent is doing work — fire-and-forget streaming events from the SDK. */
export type ExecutionEventType = (
  | SessionStartEvent
  | TextDeltaEvent
  | ToolCallStartEvent
  | ToolCallEndEvent
  | SubagentStartEvent
  | SubagentEndEvent
  | CompactEvent
  | ProgressEvent
  | NotificationEvent
  | PermissionDeniedEvent
)["eventType"];

/** Session state transitions. */
export type LifecycleEventType = (
  | ReadyEvent
  | TurnCompleteEvent
  | DoneEvent
  | InterruptedEvent
  | ErrorEvent
)["eventType"];

/** Agent is waiting for user input — has a requestId. */
export type InteractionRequestEventType = (
  | AskUserQuestionEvent
  | ConfirmActionEvent
  | SuggestSessionEvent
  | SuggestDescriptionEvent
  | SuggestStepEvent
)["eventType"];

/** Resolution of a pending interaction request. */
export type InteractionResultEventType = (
  | RequestResolvedEvent
  | RequestExpiredEvent
)["eventType"];

/** User-originated input echoed into the event log. */
export type InputEventType = UserMessageEvent["eventType"];

/** Full union of all event type strings — derived from the generated union. */
export type EventType =
  | ExecutionEventType
  | LifecycleEventType
  | InteractionRequestEventType
  | InteractionResultEventType
  | InputEventType;

// ─── Other models ─────────────────────────────────────────────────────────────

/** Mirrors backend `app.agent.models.RuntimeType` (`Literal["claude"]`). */
export type RuntimeType = "claude";

/**
 * Wire shape of a runtime-exposed skill (autocomplete suggestion).
 * Mirrors backend `app.agent.runtime.types.RuntimeSkillInfo` — camelCase
 * keys via `alias_generator=to_camel`.
 */
export interface RuntimeSkillInfo {
  id: string;
  name: string;
  description: string;
  /** "user" | "project" | "plugin" | "command" | "builtin" */
  source: string;
}

export interface AgentConfig {
  model: string;
  permissionMode: string;
  streamText: boolean;
  effort: string;
  /** Runtime-declared option toggles, keyed by RuntimeFlag.key. */
  flags?: Record<string, boolean>;
}

export interface AskUserQuestionResponse {
  questions: Question[];
  answers: Record<string, string>;
}

export interface ToolApprovalResponse {
  behavior: "allow" | "deny";
  message?: string;
  interrupt: boolean;
}

export interface AgentResult {
  bonsaiSid: string;
  sessionId: string;
  result: string;
  costUsd: number;
  turns: number;
  durationMs: number;
  usage: Record<string, unknown>;
}

export interface AgentTask {
  bonsaiSid: string;
  status: TaskStatus;
  specIds: string[];
  config: AgentConfig;
  sessionId?: string;
  created: string;
  updated: string;
}
