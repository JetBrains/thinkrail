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
import { useNotificationStore } from "./notificationStore.ts";

interface SessionStore {
  sessions: Map<string, Session>;
  activeSessionId: string | null;
  archivedSessions: ArchivedSession[];
  /** IDs of sessions explicitly closed by the user — ignore late-arriving events */
  closedIds: Set<string>;

  startSession: (params: {
    specIds: string[];
    config: AgentConfig;
    name: string;
    skillId?: string;
  }) => Promise<string>;
  sendMessage: (bonsaiSid: string, text: string) => Promise<void>;
  switchSession: (bonsaiSid: string) => void;
  closeSession: (bonsaiSid: string) => void;
  endSession: (bonsaiSid: string) => Promise<void>;
  interruptSession: (bonsaiSid: string) => Promise<void>;
  resolveRequest: (
    bonsaiSid: string,
    requestId: string,
    response: unknown,
  ) => void;

  updateConfig: (bonsaiSid: string, config: { model?: string; permissionMode?: string }) => Promise<void>;

  continueSession: (bonsaiSid: string) => Promise<void>;
  restoreSession: (bonsaiSid: string) => Promise<void>;
  loadActiveSessions: () => Promise<void>;

  // Event handlers (called by wireEvents)
  onSessionStart: (params: Record<string, unknown>) => void;
  onAgentEvent: (method: string, params: Record<string, unknown>) => void;
  onAskQuestion: (params: Record<string, unknown>) => void;
  onConfirmAction: (params: Record<string, unknown>) => void;
  onSessionDone: (params: Record<string, unknown>) => void;
  onSessionError: (params: Record<string, unknown>) => void;
  onConfigChanged: (params: Record<string, unknown>) => void;
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
  bonsaiSid: string,
  closedIds?: Set<string>,
): Map<string, Session> {
  if (sessions.has(bonsaiSid)) return sessions;
  if (closedIds?.has(bonsaiSid)) return sessions;
  const next = new Map(sessions);
  next.set(bonsaiSid, {
    bonsaiSid,
    name: bonsaiSid.slice(0, 8),
    skillId: null,
    specIds: [],
    status: "idle",
    model: "",
    permissionMode: "default",
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
  bonsaiSid: string,
  method: string,
  params: Record<string, unknown>,
  closedIds?: Set<string>,
): Map<string, Session> {
  const withSession = ensureSession(sessions, bonsaiSid, closedIds);
  const session = withSession.get(bonsaiSid);
  if (!session) return sessions;

  const event: AgentEvent = {
    bonsaiSid,
    sessionId: (params.sessionId as string) ?? "",
    eventType: method.replace("agent/", "") as AgentEvent["eventType"],
    payload: params,
  };

  const next = new Map(withSession);
  const metrics = { ...session.metrics };
  metrics.durationMs = Date.now() - session.startedAt;

  if (method === "agent/toolCallEnd") metrics.toolCalls++;

  next.set(bonsaiSid, {
    ...session,
    events: [...session.events, event],
    metrics,
  });
  return next;
}

/**
 * Reconstruct answeredRequests from persisted events.
 * For non-active sessions, unresolved requests get marked as { historical: true }.
 */
function buildAnsweredRequests(
  events: AgentEvent[],
  isActive: boolean,
): Map<string, unknown> {
  const answered = new Map<string, unknown>();

  // First pass: collect requestResolved events
  for (const ev of events) {
    if (ev.eventType === "requestResolved") {
      const rid = (ev.payload.requestId as string) ?? "";
      if (rid) answered.set(rid, ev.payload.response);
    }
  }

  // Second pass (non-active only): mark remaining unresolved requests as historical
  if (!isActive) {
    for (const ev of events) {
      if (ev.eventType === "askUserQuestion" || ev.eventType === "confirmAction") {
        const rid = (ev.payload.requestId as string) ?? "";
        if (rid && !answered.has(rid)) answered.set(rid, { historical: true });
      }
    }
  }

  return answered;
}

export const useSessionStore = create<SessionStore>((set, get) => ({
  sessions: new Map(),
  activeSessionId: null,
  archivedSessions: [],
  closedIds: new Set(),

  startSession: async ({ specIds, config, name, skillId }) => {
    const api = createAgentApi(getClient());
    const { bonsaiSid } = await api.run({ specIds, config, skillId: skillId ?? undefined, name });

    set((s) => {
      const next = new Map(s.sessions);
      const existing = next.get(bonsaiSid);
      // Merge with placeholder if events arrived before this resolved
      next.set(bonsaiSid, {
        bonsaiSid,
        name,
        skillId: skillId ?? null,
        specIds,
        status: "idle",
        model: config.model,
        permissionMode: config.permissionMode,
        startedAt: Date.now(),
        events: existing?.events ?? [],
        metrics: existing?.metrics ?? emptyMetrics(),
        pendingRequest: existing?.pendingRequest ?? null,
        answeredRequests: existing?.answeredRequests ?? new Map(),
      });
      return { sessions: next, activeSessionId: bonsaiSid };
    });

    return bonsaiSid;
  },

  sendMessage: async (bonsaiSid, text) => {
    // Add user message to events immediately (optimistic)
    set((s) => {
      const session = s.sessions.get(bonsaiSid);
      if (!session) return s;
      const next = new Map(s.sessions);
      next.set(bonsaiSid, {
        ...session,
        status: "running",
        events: [
          ...session.events,
          {
            bonsaiSid,
            sessionId: "",
            eventType: "userMessage" as const,
            payload: { text },
          },
        ],
      });
      return { sessions: next };
    });
    try {
      const api = createAgentApi(getClient());
      await api.send(bonsaiSid, text);
    } catch (err) {
      console.error("[sendMessage] failed:", err);
      const msg = err instanceof Error ? err.message : String(err);
      useNotificationStore.getState().addToast({
        eventType: "error",
        message: `Send failed: ${msg}`,
        persistent: true,
        bonsaiSid,
      });
      // Revert status and remove optimistic userMessage
      set((s) => {
        const session = s.sessions.get(bonsaiSid);
        if (!session) return s;
        const next = new Map(s.sessions);
        next.set(bonsaiSid, {
          ...session,
          status: "idle",
          events: session.events.filter(
            (e, i) =>
              !(
                e.eventType === "userMessage" &&
                i === session.events.length - 1 &&
                (e.payload.text as string) === text
              ),
          ),
        });
        return { sessions: next };
      });
    }
  },

  switchSession: (bonsaiSid) => set({ activeSessionId: bonsaiSid }),

  continueSession: async (bonsaiSid) => {
    const { createSessionApi } = await import("@/api/methods/sessions.ts");
    const api = createSessionApi(getClient());
    await api.continue(bonsaiSid);

    // If session is in memory, just update it
    if (get().sessions.has(bonsaiSid)) {
      set((s) => {
        const session = s.sessions.get(bonsaiSid);
        if (!session) return s;

        // Reconstruct answered requests, marking unresolved as historical
        const answered = buildAnsweredRequests(session.events, false);

        const next = new Map(s.sessions);
        next.set(bonsaiSid, {
          ...session,
          status: "idle",
          restored: undefined,
          pendingRequest: null,
          answeredRequests: answered,
        });
        return { sessions: next, activeSessionId: bonsaiSid };
      });
    } else {
      // Session NOT in memory — restore it first
      await get().restoreSession(bonsaiSid);
      set((s) => {
        const session = s.sessions.get(bonsaiSid);
        if (!session) return s;
        const next = new Map(s.sessions);
        next.set(bonsaiSid, { ...session, status: "idle", restored: undefined });
        return { sessions: next };
      });
    }
  },

  restoreSession: async (bonsaiSid) => {
    // Already in memory — just switch
    if (get().sessions.has(bonsaiSid)) {
      set({ activeSessionId: bonsaiSid });
      return;
    }
    // Load from backend
    const { createSessionApi } = await import("@/api/methods/sessions.ts");
    const api = createSessionApi(getClient());
    const data = await api.get(bonsaiSid);
    console.log("[restoreSession]", bonsaiSid, "data:", data ? `${(data.events ?? []).length} events` : "null");
    if (!data) return;

    // Check if this session has a live backend runner
    const allSessions = await api.list();
    const backendEntry = allSessions.find((s) => s.bonsaiSid === bonsaiSid);
    const isActive = backendEntry?.active === true;

    // Convert backend events to AgentEvent format
    const events: AgentEvent[] = (data.events ?? []).map((ev: Record<string, unknown>) => ({
      bonsaiSid,
      sessionId: ((ev.payload as Record<string, unknown>)?.sessionId as string) ?? "",
      eventType: ((ev.eventType as string) ?? "notification") as AgentEvent["eventType"],
      payload: (ev.payload as Record<string, unknown>) ?? ev,
    }));

    // Reconstruct answered requests from persisted events
    const answered = buildAnsweredRequests(events, isActive);

    const session: Session = {
      bonsaiSid,
      name: data.name ?? bonsaiSid.slice(0, 8),
      skillId: (data.skillId as string) ?? null,
      specIds: data.specIds ?? [],
      // If the backend runner is alive, use the actual status; otherwise
      // force "done" since there's nothing driving the session.
      status: isActive
        ? ((backendEntry?.status as SessionStatus) ?? "idle")
        : "done",
      model: (data.config?.model as string) ?? "",
      permissionMode: (data.config?.permissionMode as string) ?? "default",
      startedAt: new Date(data.createdAt).getTime(),
      events,
      metrics: emptyMetrics(),
      pendingRequest: null,
      answeredRequests: answered,
      restored: !isActive,
    };

    set((s) => {
      const next = new Map(s.sessions);
      next.set(bonsaiSid, session);
      const nextClosed = new Set(s.closedIds);
      nextClosed.delete(bonsaiSid);
      return { sessions: next, activeSessionId: bonsaiSid, closedIds: nextClosed };
    });
  },

  loadActiveSessions: async () => {
    const { createSessionApi } = await import("@/api/methods/sessions.ts");
    const api = createSessionApi(getClient());
    const all = await api.list();

    // Filter to active sessions not already in memory
    const currentSessions = get().sessions;
    const toLoad = all.filter((e) => e.active && !currentSessions.has(e.bonsaiSid));

    // Fetch full data (with events) for each session in parallel
    const results = await Promise.allSettled(
      toLoad.map(async (entry) => {
        const data = await api.get(entry.bonsaiSid);
        return { entry, data };
      }),
    );

    set((s) => {
      const next = new Map(s.sessions);
      for (const result of results) {
        if (result.status === "rejected") continue;
        const { entry, data } = result.value;
        if (next.has(entry.bonsaiSid)) continue;

        // Convert backend events to AgentEvent format
        const events: AgentEvent[] = (data?.events ?? []).map((ev: Record<string, unknown>) => ({
          bonsaiSid: entry.bonsaiSid,
          sessionId: ((ev.payload as Record<string, unknown>)?.sessionId as string) ?? "",
          eventType: ((ev.eventType as string) ?? "notification") as AgentEvent["eventType"],
          payload: (ev.payload as Record<string, unknown>) ?? ev,
        }));

        next.set(entry.bonsaiSid, {
          bonsaiSid: entry.bonsaiSid,
          name: data?.name ?? entry.name ?? entry.bonsaiSid.slice(0, 8),
          skillId: (data?.skillId as string) ?? entry.skillId ?? null,
          specIds: data?.specIds ?? entry.specIds ?? [],
          status: (entry.status as SessionStatus) ?? "idle",
          model: (data?.config?.model as string) ?? entry.model ?? "",
          permissionMode: (data?.config?.permissionMode as string) ?? "default",
          startedAt: new Date(entry.createdAt).getTime(),
          events,
          metrics: emptyMetrics(),
          pendingRequest: null,
          answeredRequests: buildAnsweredRequests(events, true),
        });
      }
      return { sessions: next };
    });
  },

  closeSession: (bonsaiSid) => {
    // Tell backend to gracefully close the session
    const session = get().sessions.get(bonsaiSid);
    if (session && session.status !== "done" && session.status !== "error") {
      const api = createAgentApi(getClient());
      api.end(bonsaiSid).catch(() => {});
    }
    set((s) => {
      const next = new Map(s.sessions);
      next.delete(bonsaiSid);
      const nextClosed = new Set(s.closedIds);
      nextClosed.add(bonsaiSid);
      const archived: ArchivedSession[] = session
        ? [
            ...s.archivedSessions,
            {
              bonsaiSid: session.bonsaiSid,
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
        s.activeSessionId === bonsaiSid
          ? (next.keys().next().value ?? null)
          : s.activeSessionId;
      return {
        sessions: next,
        archivedSessions: archived,
        activeSessionId: nextActive,
        closedIds: nextClosed,
      };
    });
  },

  endSession: async (bonsaiSid) => {
    const api = createAgentApi(getClient());
    await api.end(bonsaiSid);
  },

  interruptSession: async (bonsaiSid) => {
    try {
      const api = createAgentApi(getClient());
      await api.interrupt(bonsaiSid);
      // Status transition is handled by the agent/interrupted notification
    } catch (err) {
      console.warn("[interruptSession] failed:", err);
    }
  },

  resolveRequest: (bonsaiSid, requestId, response) => {
    // Send the response to the backend via agent/respond RPC method.
    // This resolves the asyncio.Future in the backend tracker.
    const api = createAgentApi(getClient());
    api.respond(bonsaiSid, requestId, response).catch((err) => {
      console.error("Failed to send agent/respond:", err);
      set((s) => {
        const session = s.sessions.get(bonsaiSid);
        if (!session || session.status !== "running") return s;
        const next = new Map(s.sessions);
        next.set(bonsaiSid, { ...session, status: "idle" });
        return { sessions: next };
      });
    });

    // Mark request as answered (store the response) and clear pendingRequest
    set((s) => {
      const session = s.sessions.get(bonsaiSid);
      if (!session) return s;
      const nextSessions = new Map(s.sessions);
      const answered = new Map(session.answeredRequests);
      answered.set(requestId, response);
      nextSessions.set(bonsaiSid, {
        ...session,
        status: "running",
        pendingRequest:
          session.pendingRequest?.requestId === requestId
            ? null
            : session.pendingRequest,
        answeredRequests: answered,
      });
      return { sessions: nextSessions };
    });

    // Dismiss related toasts, decrement counter, and clear tab badge
    const ns = useNotificationStore.getState();
    ns.decrementPendingInput();
    for (const t of ns.toasts) {
      if (t.bonsaiSid === bonsaiSid && (t.eventType === "question" || t.eventType === "approval")) {
        ns.dismissToast(t.id);
      }
    }
    ns.clearBadge(bonsaiSid);
  },

  updateConfig: async (bonsaiSid, config) => {
    const api = createAgentApi(getClient());
    await api.updateConfig(bonsaiSid, config);
  },

  onConfigChanged: (params) => {
    const bonsaiSid = params.bonsaiSid as string;
    set((s) => {
      const session = s.sessions.get(bonsaiSid);
      if (!session) return s;
      const next = new Map(s.sessions);
      next.set(bonsaiSid, {
        ...session,
        model: (params.model as string) ?? session.model,
        permissionMode: (params.permissionMode as string) ?? session.permissionMode,
      });
      return { sessions: next };
    });
  },

  onSessionStart: (params) => {
    const bonsaiSid = params.bonsaiSid as string;
    set((s) => {
      const withSession = ensureSession(s.sessions, bonsaiSid, s.closedIds);
      const session = withSession.get(bonsaiSid);
      if (!session) return s;
      const next = new Map(withSession);
      next.set(bonsaiSid, {
        ...session,
        model: (params.model as string) ?? session.model,
        events: [
          ...session.events,
          {
            bonsaiSid,
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
    const bonsaiSid = params.bonsaiSid as string;
    set((s) => {
      const sessions = appendEvent(s.sessions, bonsaiSid, method, params, s.closedIds);
      // Update session status for turn lifecycle events
      const session = sessions.get(bonsaiSid);
      if (session) {
        if (method === "agent/turnComplete" || method === "agent/interrupted") {
          sessions.set(bonsaiSid, {
            ...session,
            status: "idle",
            pendingRequest: null,
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
    const bonsaiSid = params.bonsaiSid as string;
    const requestId = params.requestId as string;
    set((s) => {
      const sessions = appendEvent(
        s.sessions,
        bonsaiSid,
        "agent/askUserQuestion",
        params,
        s.closedIds,
      );
      const session = sessions.get(bonsaiSid);
      if (session) {
        sessions.set(bonsaiSid, {
          ...session,
          status: "waiting",
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
    const bonsaiSid = params.bonsaiSid as string;
    const requestId = params.requestId as string;
    set((s) => {
      const sessions = appendEvent(
        s.sessions,
        bonsaiSid,
        "agent/confirmAction",
        params,
        s.closedIds,
      );
      const session = sessions.get(bonsaiSid);
      if (session) {
        sessions.set(bonsaiSid, {
          ...session,
          status: "waiting",
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
    const bonsaiSid = params.bonsaiSid as string;
    set((s) => {
      const sessions = appendEvent(
        s.sessions,
        bonsaiSid,
        "agent/done",
        params,
        s.closedIds,
      );
      const session = sessions.get(bonsaiSid);
      if (session) {
        sessions.set(bonsaiSid, {
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
    const bonsaiSid = params.bonsaiSid as string;
    const subtype = params.subtype as string;
    // "turn_error" = recoverable (e.g. permissions timeout) — go back to idle
    // "crash" or other = terminal error
    const isRecoverable = subtype === "turn_error";
    set((s) => {
      const sessions = appendEvent(
        s.sessions,
        bonsaiSid,
        "agent/error",
        params,
        s.closedIds,
      );
      const session = sessions.get(bonsaiSid);
      if (session) {
        sessions.set(bonsaiSid, {
          ...session,
          status: isRecoverable ? "idle" : "error",
          pendingRequest: null,
        });
      }
      return { sessions };
    });
  },

}));
