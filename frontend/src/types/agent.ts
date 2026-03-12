/** Mirrors backend/app/agent/models.py — camelCase JSON wire format. */

export type TaskStatus = "idle" | "running" | "done" | "error";

export type EventType =
  | "sessionStart"
  | "textDelta"
  | "toolCallStart"
  | "toolCallEnd"
  | "turnComplete"
  | "interrupted"
  | "subagentStart"
  | "subagentEnd"
  | "notification"
  | "compact"
  | "progress"
  | "done"
  | "error"
  | "permissionDenied"
  | "askUserQuestion"
  | "confirmAction"
  | "requestResolved"
  | "userMessage";

export interface AgentConfig {
  model: string;
  maxTurns: number;
  permissionMode: string;
  streamText: boolean;
  betas: string[];
  effort: string | null;
}

export interface QuestionOption {
  label: string;
  description: string;
}

export interface Question {
  question: string;
  header: string;
  options: QuestionOption[];
  multiSelect: boolean;
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

export interface AgentEvent {
  bonsaiSid: string;
  sessionId: string;
  eventType: EventType;
  payload: Record<string, unknown>;
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
