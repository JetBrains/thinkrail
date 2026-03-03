/** Mirrors backend/app/agent/models.py — camelCase JSON wire format. */

export type TaskStatus = "pending" | "running" | "done" | "error";

export type EventType =
  | "sessionStart"
  | "textDelta"
  | "toolCallStart"
  | "toolCallEnd"
  | "subagentStart"
  | "subagentEnd"
  | "notification"
  | "compact"
  | "progress"
  | "done"
  | "error"
  | "permissionDenied"
  | "askUserQuestion"
  | "confirmAction";

export interface AgentConfig {
  model: string;
  maxTurns: number;
  permissionMode: string;
  streamText: boolean;
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
  taskId: string;
  sessionId: string;
  eventType: EventType;
  payload: Record<string, unknown>;
}

export interface AgentResult {
  taskId: string;
  sessionId: string;
  result: string;
  costUsd: number;
  turns: number;
  durationMs: number;
  usage: Record<string, unknown>;
}

export interface AgentTask {
  id: string;
  status: TaskStatus;
  specIds: string[];
  config: AgentConfig;
  sessionId?: string;
  created: string;
  updated: string;
}
