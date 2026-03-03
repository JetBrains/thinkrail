import { create } from "zustand";
import type { AgentEvent, AgentConfig } from "@/types/agent.ts";
import type {
  Session,
  SessionStatus,
  SessionMetrics,
  ArchivedSession,
  PendingRequest,
} from "@/types/session.ts";
import { getClient } from "@/api/index.ts";
import { createAgentApi } from "@/api/methods/agents.ts";

interface SessionStore {
  sessions: Map<string, Session>;
  activeSessionId: string | null;
  archivedSessions: ArchivedSession[];

  startSession: (params: {
    specIds: string[];
    config: AgentConfig;
    name: string;
    skillId?: string;
  }) => Promise<string>;
  sendMessage: (taskId: string, text: string) => Promise<void>;
  switchSession: (taskId: string) => void;
  closeSession: (taskId: string) => void;
  endSession: (taskId: string) => Promise<void>;
  interruptSession: (taskId: string) => Promise<void>;
  resolveRequest: (
    taskId: string,
    requestId: string,
    response: unknown,
  ) => void;

  restoreSession: (taskId: string) => Promise<void>;

  // Event handlers (called by wireEvents)
  onSessionStart: (params: Record<string, unknown>) => void;
  onAgentEvent: (method: string, params: Record<string, unknown>) => void;
  onAskQuestion: (params: Record<string, unknown>) => void;
  onConfirmAction: (params: Record<string, unknown>) => void;
  onSessionDone: (params: Record<string, unknown>) => void;
  onSessionError: (params: Record<string, unknown>) => void;
}

function emptyMetrics(): SessionMetrics {
  return {
    costUsd: 0,
    turns: 0,
    toolCalls: 0,
    contextTokens: 0,
    contextMax: 0,
    durationMs: 0,
    filesChanged: {},
  };
}

/**
 * Ensure a session exists in the map. If not, create a placeholder.
 * This handles the race condition where agent events arrive before
 * startSession() finishes creating the Session object.
 */
function ensureSession(
  sessions: Map<string, Session>,
  taskId: string,
): Map<string, Session> {
  if (sessions.has(taskId)) return sessions;
  const next = new Map(sessions);
  next.set(taskId, {
    taskId,
    name: taskId.slice(0, 8),
    skillId: null,
    specIds: [],
    status: "idle",
    model: "",
    startedAt: Date.now(),
    events: [],
    metrics: emptyMetrics(),
    pendingRequest: null,
    answeredRequests: new Map(),
  });
  return next;
}

function appendEvent(
  sessions: Map<string, Session>,
  taskId: string,
  method: string,
  params: Record<string, unknown>,
): Map<string, Session> {
  const withSession = ensureSession(sessions, taskId);
  const session = withSession.get(taskId)!;

  const event: AgentEvent = {
    taskId,
    sessionId: (params.sessionId as string) ?? "",
    eventType: method.replace("agent/", "") as AgentEvent["eventType"],
    payload: params,
  };

  const next = new Map(withSession);
  const metrics = { ...session.metrics };
  metrics.durationMs = Date.now() - session.startedAt;

  if (method === "agent/toolCallEnd") metrics.toolCalls++;

  next.set(taskId, {
    ...session,
    events: [...session.events, event],
    metrics,
  });
  return next;
}

export const useSessionStore = create<SessionStore>((set, get) => ({
  sessions: new Map(),
  activeSessionId: null,
  archivedSessions: [],

  startSession: async ({ specIds, config, name, skillId }) => {
    const api = createAgentApi(getClient());
    const { taskId } = await api.run({ specIds, config, skillId: skillId ?? undefined });

    set((s) => {
      const next = new Map(s.sessions);
      const existing = next.get(taskId);
      // Merge with placeholder if events arrived before this resolved
      next.set(taskId, {
        taskId,
        name,
        skillId: skillId ?? null,
        specIds,
        status: "idle",
        model: config.model,
        startedAt: Date.now(),
        events: existing?.events ?? [],
        metrics: existing?.metrics ?? emptyMetrics(),
        pendingRequest: existing?.pendingRequest ?? null,
        answeredRequests: existing?.answeredRequests ?? new Map(),
      });
      return { sessions: next, activeSessionId: taskId };
    });

    return taskId;
  },

  sendMessage: async (taskId, text) => {
    const api = createAgentApi(getClient());
    await api.send(taskId, text);
    // Mark session as running (turn started)
    set((s) => {
      const session = s.sessions.get(taskId);
      if (!session) return s;
      const next = new Map(s.sessions);
      next.set(taskId, { ...session, status: "running" });
      return { sessions: next };
    });
  },

  switchSession: (taskId) => set({ activeSessionId: taskId }),

  restoreSession: async (taskId) => {
    // Already in memory — just switch
    if (get().sessions.has(taskId)) {
      set({ activeSessionId: taskId });
      return;
    }
    // Load from backend
    const { createSessionApi } = await import("@/api/methods/sessions.ts");
    const api = createSessionApi(getClient());
    const data = await api.get(taskId);
    console.log("[restoreSession]", taskId, "data:", data ? `${(data.events ?? []).length} events` : "null");
    if (!data) return;

    // Convert backend events to AgentEvent format
    const events: AgentEvent[] = (data.events ?? []).map((ev: Record<string, unknown>) => ({
      taskId,
      sessionId: ((ev.payload as Record<string, unknown>)?.sessionId as string) ?? "",
      eventType: ((ev.eventType as string) ?? "notification") as AgentEvent["eventType"],
      payload: (ev.payload as Record<string, unknown>) ?? ev,
    }));

    const session: Session = {
      taskId,
      name: data.name ?? taskId.slice(0, 8),
      skillId: (data.skillId as string) ?? null,
      specIds: data.specIds ?? [],
      status: (data.status as Session["status"]) ?? "done",
      model: (data.config?.model as string) ?? "",
      startedAt: new Date(data.createdAt).getTime(),
      events,
      metrics: emptyMetrics(),
      pendingRequest: null,
      answeredRequests: new Map(),
    };

    set((s) => {
      const next = new Map(s.sessions);
      next.set(taskId, session);
      return { sessions: next, activeSessionId: taskId };
    });
  },

  closeSession: (taskId) => {
    // Tell backend to gracefully close the session
    const session = get().sessions.get(taskId);
    if (session && session.status !== "done" && session.status !== "error") {
      const api = createAgentApi(getClient());
      api.end(taskId).catch(() => {});
    }
    set((s) => {
      const next = new Map(s.sessions);
      next.delete(taskId);
      const archived: ArchivedSession[] = session
        ? [
            ...s.archivedSessions,
            {
              taskId: session.taskId,
              name: session.name,
              skillId: session.skillId,
              specIds: session.specIds,
              startedAt: session.startedAt,
              endedAt: Date.now(),
              result: session.status === "done" ? "done" : "error",
              costUsd: session.metrics.costUsd,
              turns: session.metrics.turns,
              durationMs: session.metrics.durationMs,
              model: session.model,
              config: { model: session.model, maxTurns: 25, permissionMode: "default", streamText: true },
              events: session.events,
            },
          ]
        : s.archivedSessions;
      const nextActive =
        s.activeSessionId === taskId
          ? (next.keys().next().value ?? null)
          : s.activeSessionId;
      return {
        sessions: next,
        archivedSessions: archived,
        activeSessionId: nextActive,
      };
    });
  },

  endSession: async (taskId) => {
    const api = createAgentApi(getClient());
    await api.end(taskId);
  },

  interruptSession: async (taskId) => {
    const api = createAgentApi(getClient());
    await api.interrupt(taskId);
    set((s) => {
      const session = s.sessions.get(taskId);
      if (!session) return s;
      const next = new Map(s.sessions);
      next.set(taskId, { ...session, status: "interrupted" as SessionStatus });
      return { sessions: next };
    });
  },

  resolveRequest: (taskId, requestId, response) => {
    // Send the response to the backend via agent/respond RPC method.
    // This resolves the asyncio.Future in the backend tracker.
    const api = createAgentApi(getClient());
    api.respond(taskId, requestId, response).catch((err) => {
      console.error("Failed to send agent/respond:", err);
    });

    // Mark request as answered (store the response) and clear pendingRequest
    set((s) => {
      const session = s.sessions.get(taskId);
      if (!session) return s;
      const nextSessions = new Map(s.sessions);
      const answered = new Map(session.answeredRequests);
      answered.set(requestId, response);
      nextSessions.set(taskId, {
        ...session,
        pendingRequest:
          session.pendingRequest?.requestId === requestId
            ? null
            : session.pendingRequest,
        answeredRequests: answered,
      });
      return { sessions: nextSessions };
    });
  },

  onSessionStart: (params) => {
    const taskId = params.taskId as string;
    set((s) => {
      const withSession = ensureSession(s.sessions, taskId);
      const session = withSession.get(taskId)!;
      const next = new Map(withSession);
      next.set(taskId, {
        ...session,
        model: (params.model as string) ?? session.model,
        events: [
          ...session.events,
          {
            taskId,
            sessionId: (params.sessionId as string) ?? "",
            eventType: "sessionStart",
            payload: params,
          },
        ],
      });
      return { sessions: next };
    });
  },

  onAgentEvent: (method, params) => {
    const taskId = params.taskId as string;
    set((s) => {
      const sessions = appendEvent(s.sessions, taskId, method, params);
      // Update session status for turn lifecycle events
      const session = sessions.get(taskId);
      if (session) {
        if (method === "agent/turnComplete" || method === "agent/interrupted") {
          sessions.set(taskId, {
            ...session,
            status: "idle",
            metrics: {
              ...session.metrics,
              costUsd: (params.costUsd as number) ?? session.metrics.costUsd,
              turns: (params.turns as number) ?? session.metrics.turns,
              durationMs: (params.durationMs as number) ?? session.metrics.durationMs,
            },
          });
        }
      }
      return { sessions };
    });
  },

  onAskQuestion: (params) => {
    const taskId = params.taskId as string;
    const requestId = params.requestId as string;
    set((s) => {
      const sessions = appendEvent(
        s.sessions,
        taskId,
        "agent/askUserQuestion",
        params,
      );
      const session = sessions.get(taskId);
      if (session) {
        sessions.set(taskId, {
          ...session,
          pendingRequest: {
            requestId,
            type: "question",
            questions: params.questions as PendingRequest["questions"],
          },
        });
      }
      return { sessions };
    });
  },

  onConfirmAction: (params) => {
    const taskId = params.taskId as string;
    const requestId = params.requestId as string;
    set((s) => {
      const sessions = appendEvent(
        s.sessions,
        taskId,
        "agent/confirmAction",
        params,
      );
      const session = sessions.get(taskId);
      if (session) {
        sessions.set(taskId, {
          ...session,
          pendingRequest: {
            requestId,
            type: "approval",
            toolName: params.toolName as string,
            toolInput: params.toolInput as Record<string, unknown>,
          },
        });
      }
      return { sessions };
    });
  },

  onSessionDone: (params) => {
    const taskId = params.taskId as string;
    set((s) => {
      const sessions = appendEvent(
        s.sessions,
        taskId,
        "agent/done",
        params,
      );
      const session = sessions.get(taskId);
      if (session) {
        sessions.set(taskId, {
          ...session,
          status: "done",
          pendingRequest: null,
          metrics: {
            ...session.metrics,
            costUsd: (params.costUsd as number) ?? session.metrics.costUsd,
            durationMs:
              (params.durationMs as number) ?? session.metrics.durationMs,
            turns: (params.turns as number) ?? session.metrics.turns,
          },
        });
      }
      return { sessions };
    });
  },

  onSessionError: (params) => {
    const taskId = params.taskId as string;
    set((s) => {
      const sessions = appendEvent(
        s.sessions,
        taskId,
        "agent/error",
        params,
      );
      const session = sessions.get(taskId);
      if (session) {
        sessions.set(taskId, {
          ...session,
          status: "error",
          pendingRequest: null,
        });
      }
      return { sessions };
    });
  },

}));
