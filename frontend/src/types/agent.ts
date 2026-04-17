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
  ConfirmStatementEvent,
  SuggestSessionEvent,
  SuggestDescriptionEvent,
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
  ConfirmStatementEvent,
  SuggestSessionEvent,
  SuggestDescriptionEvent,
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
  | ConfirmStatementEvent
  | SuggestSessionEvent
  | SuggestDescriptionEvent
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

export interface AgentConfig {
  model: string;
  maxTurns: number;
  permissionMode: string;
  streamText: boolean;
  betas: string[];
  effort: string | null;
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
