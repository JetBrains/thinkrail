import type { RpcClient } from "../client.ts";

export interface SessionSummary {
  bonsaiSid: string;
  name: string;
  skillId?: string;
  specIds: string[];
  status: string;
  model?: string;
  /** The meta-ticket this session is attached to, if any. */
  ticketId?: string | null;
  createdAt: string;
  updatedAt: string;
  metrics?: Record<string, unknown>;
  active?: boolean;
  /** Whether the session has a live runner in the backend tracker */
  inTracker?: boolean;
  /** Latest TodoWrite/Task* snapshot persisted by the backend. Cold-cache
   *  fallback so Tasks (n/m) sub-rows render even for sessions that
   *  aren't loaded in memory (e.g. after page reload). Live in-session
   *  updates still derive from events on the client for per-task
   *  scroll-to-event affordances. */
  todos?: { key: string; content: string; status: string }[];
  /** Present for draft sessions — full config object */
  config?: Record<string, unknown>;
  /** Present for draft sessions — assembled system prompt */
  systemPrompt?: string;
  /** Present for draft sessions — user's session prompt */
  sessionPrompt?: string;
  /** Present for draft sessions — in-progress prompt text autosaved as the
   *  user types. Non-context: restored into the input box, never assembled
   *  into the system prompt. */
  draftInput?: string | null;
  /** ticket-implement orchestrator only — execution mode (see
   *  TICKET_LIFECYCLE_DESIGN.md § Implementation orchestration modes). */
  subagentMode?: "step-session" | "subagent";
  /** Only meaningful when subagentMode === "subagent". */
  stepGate?: "approve" | "autonomous";
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
  /** Ticket this session is attached to. Persisted on the AgentTask
   *  serialized as `ticketId`. Read on restore so the live Session
   *  carries the ticket link for routing/labeling. */
  ticketId?: string | null;
  /** ticket-implement orchestrator only — execution mode. */
  subagentMode?: "step-session" | "subagent";
  /** Only meaningful when subagentMode === "subagent". */
  stepGate?: "approve" | "autonomous";
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

    subscribe: (bonsaiSid: string) =>
      client.request<void>("session/subscribe", { bonsaiSid }),

    unsubscribe: (bonsaiSid: string) =>
      client.request<void>("session/unsubscribe", { bonsaiSid }),
  };
}

export type SessionApi = ReturnType<typeof createSessionApi>;
