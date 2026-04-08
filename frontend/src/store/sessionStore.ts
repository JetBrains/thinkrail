import { create } from "zustand";
import type { AgentEvent, AgentConfig } from "@/types/agent.ts";
import type {
  Session,
  SessionStatus,
  SessionMetrics,
  ContextUsage,
  TurnUsage,
  IterationUsage,
  ArchivedSession,
  PendingRequest,
} from "@/types/session.ts";
import { getClient } from "@/api/index.ts";
import { createAgentApi } from "@/api/methods/agents.ts";
import { getContextWindowSize, DEFAULT_MODEL } from "@/utils/models.ts";
import { useNotificationStore } from "./notificationStore.ts";
import { useBoardStore } from "./boardStore.ts";
import { useFileStore } from "./fileStore.ts";
import { getErrorMessage } from "@/utils/errors.ts";

interface SessionStore {
  sessions: Map<string, Session>;
  activeSessionId: string | null;
  archivedSessions: ArchivedSession[];
  /** IDs of sessions explicitly ended by the user — ignore late-arriving events */
  closedIds: Set<string>;
  /** Which sessions have a visible tab in the tab bar */
  openTabs: Set<string>;
  /** Sum of costUsd across all known sessions (in-memory + from backend list) */
  projectCost: number;
  /** Monotonically increasing counter for default "Session N" names */
  sessionCounter: number;

  /** Create a draft session with sensible defaults. Used by + New, Cmd+T, palette. */
  createNewSession: (prefill?: {
    skillId?: string;
    specIds?: string[];
    name?: string;
    metaTicketId?: string;
  }) => Promise<string>;

  startSession: (params: {
    specIds: string[];
    config: AgentConfig;
    name: string;
    skillId?: string;
    prompt?: string;
    metaTicketId?: string;
  }) => Promise<string>;
  createDraft: (params: {
    specIds: string[];
    config: AgentConfig;
    name: string;
    skillId?: string;
    prompt?: string;
    metaTicketId?: string;
    filePaths?: string[];
  }) => Promise<string>;
  updateDraft: (bonsaiSid: string, changes: {
    specIds?: string[];
    filePaths?: string[];
    skillId?: string | null;
    config?: AgentConfig;
    prompt?: string | null;
    name?: string;
    metaTicketId?: string | null;
  }) => Promise<string>;
  startDraft: (bonsaiSid: string, prompt?: string) => Promise<void>;
  sendMessage: (bonsaiSid: string, text: string, isMarkdown?: boolean) => Promise<void>;
  switchSession: (bonsaiSid: string) => void;
  closeSession: (bonsaiSid: string) => void;
  /** Delete/trash a session: calls backend API, closes tab, removes from store */
  deleteSession: (bonsaiSid: string) => Promise<void>;
  endSession: (bonsaiSid: string) => Promise<void>;
  /** Open a tab for a session (e.g., from background indicator dropdown) */
  openTab: (bonsaiSid: string) => void;
  /** Ticket-aware focus: opens tab, navigates to ticket if linked, clears conflicting state */
  focusSession: (bonsaiSid: string) => void;
  interruptSession: (bonsaiSid: string) => Promise<void>;
  resolveRequest: (
    bonsaiSid: string,
    requestId: string,
    response: unknown,
  ) => void;

  updateConfig: (bonsaiSid: string, config: { model?: string; permissionMode?: string; betas?: string[]; effort?: string | null }) => Promise<void>;
  restartSession: (bonsaiSid: string) => Promise<void>;

  continueSession: (bonsaiSid: string) => Promise<void>;
  restoreSession: (bonsaiSid: string, opts?: { noTab?: boolean }) => Promise<void>;
  loadActiveSessions: () => Promise<void>;

  /** Poll backend for actual status of sessions stuck in transient states */
  syncSessionStatuses: () => Promise<void>;

  unload: () => void;

  // Event handlers (called by wireEvents)
  onSessionStart: (params: Record<string, unknown>) => void;
  onAgentEvent: (method: string, params: Record<string, unknown>) => void;
  onAskQuestion: (params: Record<string, unknown>) => void;
  onConfirmAction: (params: Record<string, unknown>) => void;
  onSuggestSession: (params: Record<string, unknown>) => void;
  onSuggestDescription: (params: Record<string, unknown>) => void;
  onSuggestStep: (params: Record<string, unknown>) => void;
  onSessionDone: (params: Record<string, unknown>) => void;
  onSessionError: (params: Record<string, unknown>) => void;
  onConfigChanged: (params: Record<string, unknown>) => void;
}

function emptyContextUsage(): ContextUsage {
  return {
    contextMax: 0,
    contextTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    inputTokens: 0,
    turnHistory: [],
    runBoundaries: [],
    toolCallCounts: {},
    toolTokens: {},
    filesRead: [],
    filesWritten: [],
  };
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
    contextUsage: emptyContextUsage(),
  };
}

/**
 * Reconstruct cost from persisted events by scanning backwards
 * for the last turnComplete or done event with costUsd.
 */
function reconstructCost(events: AgentEvent[]): number {
  for (let i = events.length - 1; i >= 0; i--) {
    const p = events[i].payload;
    const type = events[i].eventType;
    if ((type === "turnComplete" || type === "done") && typeof p?.costUsd === "number") {
      return p.costUsd;
    }
  }
  return 0;
}

/**
 * Reconstruct context usage from persisted events.
 * Scans for turnComplete/interrupted events with usage data and
 * toolCallStart events for tool/file tracking.
 */
function reconstructContextUsage(events: AgentEvent[], model: string, _betas: string[] = []): ContextUsage {
  const cu = emptyContextUsage();
  cu.contextMax = getContextWindowSize(model);
  const toolUseIdToName = new Map<string, string>();

  for (const ev of events) {
    const p = ev.payload;

    // Record run boundaries from sessionStart events
    if (ev.eventType === "sessionStart") {
      cu.runBoundaries.push(cu.turnHistory.length);
    }

    // Accumulate turn usage from turnComplete/interrupted events
    if ((ev.eventType === "turnComplete" || ev.eventType === "interrupted") && p?.usage) {
      const usage = p.usage as Record<string, number>;

      // Per-iteration data (new events carry this array)
      const rawIters = (p.iterations as Record<string, number>[]) ?? [];
      const lastIter = rawIters.length > 0 ? rawIters[rawIters.length - 1] : null;

      // All breakdown values from last iteration so they add up:
      // inputTokens (fresh) + cacheRead + cacheCreate + output = contextTokens.
      const inputTokens = lastIter ? (lastIter.input_tokens ?? 0) : (usage.input_tokens ?? 0);
      const cacheCreation = lastIter ? (lastIter.cache_creation_input_tokens ?? 0) : (usage.cache_creation_input_tokens ?? 0);
      const cacheRead = lastIter ? (lastIter.cache_read_input_tokens ?? 0) : (usage.cache_read_input_tokens ?? 0);
      const outputTokens = lastIter ? (lastIter.output_tokens ?? 0) : (usage.output_tokens ?? 0);

      const totalContext = (p.contextWindow as number) || (inputTokens + cacheCreation + cacheRead + outputTokens);

      cu.contextTokens = totalContext;
      cu.outputTokens = outputTokens;
      cu.inputTokens = inputTokens;
      cu.cacheReadTokens = cacheRead;
      cu.cacheCreationTokens = cacheCreation;

      // Convert raw iterations to typed IterationUsage[]
      const iterations: IterationUsage[] = rawIters.map((it) => {
        const cc = (it as Record<string, unknown>).cache_creation as Record<string, number> | null | undefined;
        return {
          type: (it.type as unknown as string) === "compaction" ? "compaction" as const : "message" as const,
          inputTokens: (it.input_tokens as number) ?? 0,
          outputTokens: (it.output_tokens as number) ?? 0,
          cacheCreationInputTokens: (it.cache_creation_input_tokens as number) ?? 0,
          cacheReadInputTokens: (it.cache_read_input_tokens as number) ?? 0,
          ...(cc ? { cacheCreation: {
            ephemeral5mInputTokens: cc.ephemeral_5m_input_tokens ?? 0,
            ephemeral1hInputTokens: cc.ephemeral_1h_input_tokens ?? 0,
          } } : {}),
        };
      });

      cu.turnHistory.push({
        turnIndex: cu.turnHistory.length,
        inputTokens,
        outputTokens,
        cacheCreationTokens: cacheCreation,
        cacheReadTokens: cacheRead,
        totalContextTokens: totalContext,
        costUsd: (p.turnCostUsd as number) ?? 0,
        timestamp: 0, // not available from persisted events
        sdkTurns: (p.turn_turns as number) ?? 1,
        iterations: iterations.length > 0 ? iterations : undefined,
      });
    }

    // Track tool calls and files
    if (ev.eventType === "toolCallStart" && p) {
      const toolName = (p.toolName as string) ?? "";
      const toolUseId = (p.toolUseId as string) ?? "";
      cu.toolCallCounts[toolName] = (cu.toolCallCounts[toolName] ?? 0) + 1;

      if (toolUseId) toolUseIdToName.set(toolUseId, toolName);

      const toolInput = (p.toolInput as Record<string, unknown>) ?? {};

      // Estimate input tokens from serialized tool input (~4 chars per token)
      const inputEstimate = Math.ceil(JSON.stringify(toolInput).length / 4);
      if (!cu.toolTokens[toolName]) cu.toolTokens[toolName] = { inputTokens: 0, outputTokens: 0 };
      cu.toolTokens[toolName].inputTokens += inputEstimate;

      if (toolName === "Read" || toolName === "Grep" || toolName === "Glob") {
        const filePath = ((toolInput.file_path ?? toolInput.path ?? "") as string);
        if (filePath && !cu.filesRead.includes(filePath)) cu.filesRead.push(filePath);
      }
      if (toolName === "Write" || toolName === "Edit" || toolName === "NotebookEdit") {
        const filePath = ((toolInput.file_path ?? "") as string);
        if (filePath && !cu.filesWritten.includes(filePath)) cu.filesWritten.push(filePath);
      }
    }

    // Track tool output tokens
    if (ev.eventType === "toolCallEnd" && p) {
      const toolUseId = (p.toolUseId as string) ?? "";
      const toolName = toolUseIdToName.get(toolUseId) ?? "";
      if (toolName) {
        const output = (p.output as string) ?? "";
        const outputEstimate = Math.ceil(output.length / 4);
        if (!cu.toolTokens[toolName]) cu.toolTokens[toolName] = { inputTokens: 0, outputTokens: 0 };
        cu.toolTokens[toolName].outputTokens += outputEstimate;
      }
    }
  }

  return cu;
}

/**
 * Apply cost + metrics from event params to a session, returning the
 * updated session and the change in project-wide cost.
 */
function applyMetrics(
  session: Session,
  params: Record<string, unknown>,
  status: SessionStatus,
): { updated: Session; costDelta: number } {
  const newCost = (params.costUsd as number) ?? session.metrics.costUsd;
  const costDelta = newCost - session.metrics.costUsd;

  // Parse the usage dict from the SDK (arrives on turnComplete/interrupted/done)
  const usage = (params.usage as Record<string, number> | undefined) ?? {};

  // Per-iteration data (new events carry this array)
  const rawIters = (params.iterations as Record<string, number>[]) ?? [];
  const lastIter = rawIters.length > 0 ? rawIters[rawIters.length - 1] : null;

  // All breakdown values come from the LAST iteration so they add up
  // correctly: inputTokens (fresh) + cacheRead + cacheCreate + output = contextTokens.
  // For old events without iterations, fall back to SDK aggregate usage.
  const inputTokens = lastIter ? (lastIter.input_tokens ?? 0) : (usage.input_tokens ?? 0);
  const cacheCreation = lastIter ? (lastIter.cache_creation_input_tokens ?? 0) : (usage.cache_creation_input_tokens ?? 0);
  const cacheRead = lastIter ? (lastIter.cache_read_input_tokens ?? 0) : (usage.cache_read_input_tokens ?? 0);
  const outputTokens = lastIter ? (lastIter.output_tokens ?? 0) : (usage.output_tokens ?? 0);

  // Context window = all tokens in the last API call.
  const totalContext = (params.contextWindow as number) || (inputTokens + cacheCreation + cacheRead + outputTokens);
  const contextMax = getContextWindowSize(session.model);

  // Convert raw iterations to typed IterationUsage[]
  const iterations: IterationUsage[] = rawIters.map((it) => ({
    type: (it.type as unknown as string) === "compaction" ? "compaction" as const : "message" as const,
    inputTokens: (it.input_tokens as number) ?? 0,
    outputTokens: (it.output_tokens as number) ?? 0,
    cacheCreationInputTokens: (it.cache_creation_input_tokens as number) ?? 0,
    cacheReadInputTokens: (it.cache_read_input_tokens as number) ?? 0,
  }));

  const prevUsage = session.metrics.contextUsage;
  const turnUsage: TurnUsage = {
    turnIndex: prevUsage.turnHistory.length,
    inputTokens,
    outputTokens,
    cacheCreationTokens: cacheCreation,
    cacheReadTokens: cacheRead,
    totalContextTokens: totalContext,
    costUsd: (params.turnCostUsd as number) ?? 0,
    timestamp: Date.now(),
    sdkTurns: (params.turn_turns as number) ?? 1,
    iterations: iterations.length > 0 ? iterations : undefined,
  };

  return {
    updated: {
      ...session,
      status,
      pendingRequest: null,
      metrics: {
        ...session.metrics,
        costUsd: newCost,
        turns: (params.turns as number) ?? session.metrics.turns,
        durationMs: (params.durationMs as number) ?? session.metrics.durationMs,
        contextTokens: totalContext,
        contextMax,
        contextUsage: {
          ...prevUsage,
          contextMax,
          contextTokens: totalContext,
          outputTokens,
          cacheReadTokens: cacheRead,
          cacheCreationTokens: cacheCreation,
          inputTokens,
          turnHistory: [...prevUsage.turnHistory, turnUsage],
        },
      },
    },
    costDelta,
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
    filePaths: [],
    status: "initializing",
    model: "",
    permissionMode: "default",
    betas: [],
    effort: null,
    maxTurns: 50,
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
  // Skip ephemeral events — costEstimate and statusChanged update state directly,
  // not stored in events history.
  if (method === "agent/costEstimate" || method === "agent/statusChanged") return sessions;
  // Don't create phantom sessions — only update sessions that already exist
  if (!sessions.has(bonsaiSid)) return sessions;
  if (closedIds?.has(bonsaiSid)) return sessions;

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

  if (method === "agent/toolCallEnd") {
    metrics.toolCalls++;
    // Estimate output tokens and attribute to the matching toolCallStart
    const toolUseId = (params.toolUseId as string) ?? "";
    let toolName = "";
    if (toolUseId) {
      // Search backwards through events to find the matching toolCallStart
      const events = session.events;
      for (let i = events.length - 1; i >= 0; i--) {
        const ev = events[i];
        if (ev.eventType === "toolCallStart" && ev.payload?.toolUseId === toolUseId) {
          toolName = (ev.payload.toolName as string) ?? "";
          break;
        }
      }
    }
    if (toolName) {
      const cu = { ...metrics.contextUsage };
      const tt = { ...cu.toolTokens };
      const entry = tt[toolName] ? { ...tt[toolName] } : { inputTokens: 0, outputTokens: 0 };
      const output = (params.output as string) ?? "";
      entry.outputTokens += Math.ceil(output.length / 4);
      tt[toolName] = entry;
      cu.toolTokens = tt;
      metrics.contextUsage = cu;
    }
  }

  // Track tool call counts and files accessed
  if (method === "agent/toolCallStart") {
    const toolName = (params.toolName as string) ?? "";
    const toolInput = (params.toolInput as Record<string, unknown>) ?? {};
    const cu = { ...metrics.contextUsage };
    const counts = { ...cu.toolCallCounts };
    counts[toolName] = (counts[toolName] ?? 0) + 1;
    cu.toolCallCounts = counts;

    // Estimate input tokens from serialized tool input
    const tt = { ...cu.toolTokens };
    const entry = tt[toolName] ? { ...tt[toolName] } : { inputTokens: 0, outputTokens: 0 };
    entry.inputTokens += Math.ceil(JSON.stringify(toolInput).length / 4);
    tt[toolName] = entry;
    cu.toolTokens = tt;

    if (toolName === "Read" || toolName === "Grep" || toolName === "Glob") {
      const filePath = ((toolInput.file_path ?? toolInput.path ?? "") as string);
      if (filePath && !cu.filesRead.includes(filePath)) {
        cu.filesRead = [...cu.filesRead, filePath];
      }
    }
    if (toolName === "Write" || toolName === "Edit" || toolName === "NotebookEdit") {
      const filePath = ((toolInput.file_path ?? "") as string);
      if (filePath && !cu.filesWritten.includes(filePath)) {
        cu.filesWritten = [...cu.filesWritten, filePath];
      }
    }
    metrics.contextUsage = cu;
  }

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
      if (ev.eventType === "askUserQuestion" || ev.eventType === "confirmAction" || ev.eventType === "suggestSession" || ev.eventType === "suggestDescription") {
        const rid = (ev.payload.requestId as string) ?? "";
        if (rid && !answered.has(rid)) answered.set(rid, { historical: true });
      }
    }
  }

  return answered;
}

/** Tracks in-flight restoreSession fetches to prevent duplicate concurrent loads. */
const _restoring = new Set<string>();

/** Streaming events that imply the backend is running (belt-and-suspenders guard). */
const _RUNNING_SIGNALS = new Set(["agent/textDelta", "agent/toolCallStart", "agent/costEstimate"]);

export const useSessionStore = create<SessionStore>((set, get) => ({
  sessions: new Map(),
  activeSessionId: null,
  archivedSessions: [],
  closedIds: new Set(),
  openTabs: new Set(),
  projectCost: 0,
  sessionCounter: 0,

  createNewSession: async (prefill) => {
    const state = get();
    const counter = state.sessionCounter + 1;
    set({ sessionCounter: counter });
    const name = prefill?.name ?? `Session ${counter}`;
    const bonsaiSid = await state.createDraft({
      specIds: prefill?.specIds ?? [],
      config: {
        model: DEFAULT_MODEL,
        maxTurns: 50,
        permissionMode: "default",
        streamText: true,
        betas: [],
        effort: null,
      },
      name,
      skillId: prefill?.skillId,
      metaTicketId: prefill?.metaTicketId,
    });
    return bonsaiSid;
  },

  startSession: async ({ specIds, config, name, skillId, prompt, metaTicketId }) => {
    const api = createAgentApi(getClient());
    const { bonsaiSid } = await api.run({ specIds, config, skillId: skillId ?? undefined, prompt: prompt ?? undefined, name, metaTicketId: metaTicketId ?? undefined });

    set((s) => {
      const next = new Map(s.sessions);
      const existing = next.get(bonsaiSid);
      // Merge with placeholder if events arrived before this resolved.
      // Preserve status if agent/ready already transitioned it past "initializing".
      const resolvedStatus = existing && existing.status !== "initializing"
        ? existing.status
        : "initializing";
      next.set(bonsaiSid, {
        bonsaiSid,
        name,
        skillId: skillId ?? null,
        specIds,
        filePaths: [],
        status: resolvedStatus,
        model: config.model,
        permissionMode: config.permissionMode,
        betas: config.betas ?? [],
        effort: config.effort ?? null,
        maxTurns: config.maxTurns,
        startedAt: Date.now(),
        events: existing?.events ?? [],
        metrics: existing?.metrics ?? emptyMetrics(),
        pendingRequest: existing?.pendingRequest ?? null,
        answeredRequests: existing?.answeredRequests ?? new Map(),
        metaTicketId: metaTicketId ?? null,
      });
      if (metaTicketId) {
        return { sessions: next };
      }
      const tabs = new Set(s.openTabs);
      tabs.add(bonsaiSid);
      return { sessions: next, openTabs: tabs, activeSessionId: bonsaiSid };
    });

    return bonsaiSid;
  },

  createDraft: async ({ specIds, config, name, skillId, prompt, metaTicketId, filePaths }) => {
    const api = createAgentApi(getClient());
    const { bonsaiSid, systemPrompt, sections } = await api.prepare({
      specIds,
      config,
      skillId: skillId ?? undefined,
      prompt: prompt ?? undefined,
      name,
      metaTicketId: metaTicketId ?? undefined,
      filePaths: filePaths ?? undefined,
    });

    set((s) => {
      const next = new Map(s.sessions);
      next.set(bonsaiSid, {
        bonsaiSid,
        name,
        skillId: skillId ?? null,
        specIds,
        filePaths: filePaths ?? [],
        status: "draft",
        model: config.model,
        permissionMode: config.permissionMode,
        betas: config.betas ?? [],
        effort: config.effort ?? null,
        maxTurns: config.maxTurns,
        startedAt: Date.now(),
        events: [],
        metrics: emptyMetrics(),
        pendingRequest: null,
        answeredRequests: new Map(),
        metaTicketId: metaTicketId ?? null,
        systemPrompt,
        promptSections: (sections as Session["promptSections"]) ?? null,
      });
      if (metaTicketId) {
        return { sessions: next };
      }
      const tabs = new Set(s.openTabs);
      tabs.add(bonsaiSid);
      return { sessions: next, openTabs: tabs, activeSessionId: bonsaiSid };
    });

    return bonsaiSid;
  },

  updateDraft: async (bonsaiSid, changes) => {
    const api = createAgentApi(getClient());
    const result = await api.updateDraft({
      bonsaiSid,
      ...changes,
    });
    const systemPrompt = result.systemPrompt as string;
    const promptSections = (result.sections as Session["promptSections"]) ?? null;

    set((s) => {
      const session = s.sessions.get(bonsaiSid);
      if (!session || session.status !== "draft") return s;
      const next = new Map(s.sessions);
      next.set(bonsaiSid, {
        ...session,
        ...(changes.specIds !== undefined ? { specIds: changes.specIds } : {}),
        ...(changes.skillId !== undefined ? { skillId: changes.skillId } : {}),
        ...(changes.config ? {
          model: changes.config.model,
          permissionMode: changes.config.permissionMode,
          betas: changes.config.betas ?? [],
          effort: changes.config.effort ?? null,
          maxTurns: changes.config.maxTurns,
        } : {}),
        ...(changes.name !== undefined ? { name: changes.name } : {}),
        ...(changes.metaTicketId !== undefined ? { metaTicketId: changes.metaTicketId } : {}),
        ...(changes.filePaths !== undefined ? { filePaths: changes.filePaths } : {}),
        systemPrompt,
        promptSections,
      });
      return { sessions: next };
    });

    return systemPrompt;
  },

  startDraft: async (bonsaiSid, prompt) => {
    const api = createAgentApi(getClient());
    await api.startDraft(bonsaiSid, prompt);

    set((s) => {
      const session = s.sessions.get(bonsaiSid);
      if (!session) return s;
      // Seed context with system prompt tokens so the counter doesn't start at 0
      const promptTokens = session.promptSections
        ? session.promptSections.reduce((sum, sec) => sum + sec.tokens, 0)
        : 0;
      const contextMax = getContextWindowSize(session.model);
      const next = new Map(s.sessions);
      next.set(bonsaiSid, {
        ...session,
        status: "initializing",
        metrics: {
          ...session.metrics,
          contextTokens: promptTokens,
          contextMax,
          contextUsage: {
            ...session.metrics.contextUsage,
            contextTokens: promptTokens,
            contextMax,
            inputTokens: promptTokens,
          },
        },
      });
      return { sessions: next };
    });
  },

  sendMessage: async (bonsaiSid, text, isMarkdown) => {
    // If session is in draft status, auto-start it with this message.
    // Start the session first (sessionStart event arrives via WebSocket during
    // the RPC call), then add the userMessage so it appears after the config card.
    const session = get().sessions.get(bonsaiSid);
    if (session?.status === "draft") {
      await get().startDraft(bonsaiSid, text);
      set((s) => {
        const sess = s.sessions.get(bonsaiSid);
        if (!sess) return s;
        const next = new Map(s.sessions);
        next.set(bonsaiSid, {
          ...sess,
          events: [
            ...sess.events,
            {
              bonsaiSid,
              sessionId: "",
              eventType: "userMessage" as const,
              payload: { text, isMarkdown: isMarkdown ?? false },
            },
          ],
        });
        return { sessions: next };
      });
      return;
    }

    // Add user message to events immediately (optimistic).
    // Status is NOT changed here — backend drives transitions:
    //   idle → running happens when runner calls client.query()
    //   and we receive agent/sessionStart or agent/textDelta.
    set((s) => {
      const session = s.sessions.get(bonsaiSid);
      if (!session) return s;
      const next = new Map(s.sessions);
      next.set(bonsaiSid, {
        ...session,
        events: [
          ...session.events,
          {
            bonsaiSid,
            sessionId: "",
            eventType: "userMessage" as const,
            payload: { text, isMarkdown: isMarkdown ?? false },
          },
        ],
      });
      return { sessions: next };
    });
    try {
      const api = createAgentApi(getClient());
      await api.send(bonsaiSid, text, isMarkdown);
    } catch (err) {
      console.error("[sendMessage] failed:", err);
      const msg = getErrorMessage(err);
      useNotificationStore.getState().addToast({
        eventType: "error",
        message: `Send failed: ${msg}`,
        persistent: true,
        bonsaiSid,
      });
      // Remove optimistic userMessage on failure
      set((s) => {
        const session = s.sessions.get(bonsaiSid);
        if (!session) return s;
        const next = new Map(s.sessions);
        next.set(bonsaiSid, {
          ...session,
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
          status: "initializing",
          restored: undefined,
          pendingRequest: null,
          answeredRequests: answered,
        });
        const tabs = new Set(s.openTabs);
        tabs.add(bonsaiSid);
        return { sessions: next, openTabs: tabs, activeSessionId: bonsaiSid };
      });
    } else {
      // Session NOT in memory — restore it first (with tab)
      await get().restoreSession(bonsaiSid);
      set((s) => {
        const session = s.sessions.get(bonsaiSid);
        if (!session) return s;
        const next = new Map(s.sessions);
        next.set(bonsaiSid, { ...session, status: "initializing", restored: undefined });
        const tabs = new Set(s.openTabs);
        tabs.add(bonsaiSid);
        return { sessions: next, openTabs: tabs };
      });
    }
  },

  restoreSession: async (bonsaiSid, opts) => {
    const noTab = opts?.noTab ?? false;
    // Already in memory or already being restored — just open tab if needed
    if (get().sessions.has(bonsaiSid) || _restoring.has(bonsaiSid)) {
      if (!noTab) {
        set((s) => {
          const tabs = new Set(s.openTabs);
          tabs.add(bonsaiSid);
          return { openTabs: tabs, activeSessionId: bonsaiSid };
        });
      }
      return;
    }
    // Load from backend (guard against concurrent fetches)
    _restoring.add(bonsaiSid);
    try {
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

    const restoredCost = reconstructCost(events);
    const restoredModel = (data.config?.model as string) ?? "";
    const restoredBetas = (data.config?.betas as string[]) ?? [];
    const restoredCtx = reconstructContextUsage(events, restoredModel, restoredBetas);
    const diskMetrics = (data?.metrics ?? {}) as Record<string, unknown>;

    // Restore system prompt from sessionStart event payload
    const restoredPrompt = events.find((e) => e.eventType === "sessionStart")?.payload.systemPrompt as string | undefined;

    const session: Session = {
      bonsaiSid,
      name: data.name ?? bonsaiSid.slice(0, 8),
      skillId: (data.skillId as string) ?? null,
      specIds: data.specIds ?? [],
      filePaths: (data.filePaths as string[]) ?? [],
      // If the backend runner is alive, use the actual status; otherwise
      // force "done" since there's nothing driving the session.
      status: isActive
        ? ((backendEntry?.status as SessionStatus) ?? "idle")
        : "done",
      model: restoredModel,
      permissionMode: (data.config?.permissionMode as string) ?? "default",
      betas: restoredBetas,
      effort: (data.config?.effort as string) ?? null,
      maxTurns: (data.config?.maxTurns as number) ?? 50,
      startedAt: new Date(data.createdAt).getTime(),
      events,
      metrics: {
        ...emptyMetrics(),
        costUsd: restoredCost,
        turns: typeof diskMetrics.turns === "number" ? diskMetrics.turns : 0,
        toolCalls: typeof diskMetrics.toolCalls === "number" ? diskMetrics.toolCalls : 0,
        durationMs: typeof diskMetrics.durationMs === "number" ? diskMetrics.durationMs : 0,
        contextTokens: restoredCtx.contextTokens,
        contextMax: restoredCtx.contextMax,
        contextUsage: restoredCtx,
      },
      pendingRequest: null,
      answeredRequests: answered,
      restored: !isActive,
      ...(restoredPrompt ? { systemPrompt: restoredPrompt } : {}),
    };

    set((s) => {
      const next = new Map(s.sessions);
      next.set(bonsaiSid, session);
      const nextClosed = new Set(s.closedIds);
      nextClosed.delete(bonsaiSid);
      if (noTab) {
        return { sessions: next, closedIds: nextClosed };
      }
      const tabs = new Set(s.openTabs);
      tabs.add(bonsaiSid);
      return { sessions: next, openTabs: tabs, activeSessionId: bonsaiSid, closedIds: nextClosed };
    });
    } finally {
      _restoring.delete(bonsaiSid);
    }
  },

  unload: () => {
    set({
      sessions: new Map(),
      activeSessionId: null,
      archivedSessions: [],
      closedIds: new Set(),
      openTabs: new Set(),
      projectCost: 0,
      sessionCounter: 0,
    });
  },

  loadActiveSessions: async () => {
    const { createSessionApi } = await import("@/api/methods/sessions.ts");
    const api = createSessionApi(getClient());
    const all = await api.list();

    // Compute project cost from ALL sessions returned by the list API
    // (includes metrics.costUsd from persisted metadata)
    let totalProjectCost = 0;
    for (const entry of all) {
      const m = entry.metrics;
      totalProjectCost += (typeof m?.costUsd === "number" ? m.costUsd : 0);
    }

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

        const restoredCost = reconstructCost(events);
        const entryModel = (data?.config?.model as string) ?? entry.model ?? "";
        const entryBetas = (data?.config?.betas as string[]) ?? [];
        const restoredCtx = reconstructContextUsage(events, entryModel, entryBetas);
        const diskMetrics = (data?.metrics ?? {}) as Record<string, unknown>;

        // Restore system prompt: from entry (drafts) or from sessionStart event payload
        const restoredPrompt = entry.systemPrompt as string | undefined
          ?? (events.find((e) => e.eventType === "sessionStart")?.payload.systemPrompt as string | undefined);

        next.set(entry.bonsaiSid, {
          bonsaiSid: entry.bonsaiSid,
          name: data?.name ?? entry.name ?? entry.bonsaiSid.slice(0, 8),
          skillId: (data?.skillId as string) ?? entry.skillId ?? null,
          specIds: data?.specIds ?? entry.specIds ?? [],
          filePaths: (data?.filePaths as string[]) ?? [],
          status: entry.active && !entry.inTracker ? "done" : ((entry.status as SessionStatus) ?? "idle"),
          model: entryModel,
          permissionMode: (data?.config?.permissionMode as string) ?? "default",
          betas: entryBetas,
          effort: (data?.config?.effort as string) ?? null,
          maxTurns: (data?.config?.maxTurns as number) ?? 50,
          startedAt: new Date(entry.createdAt).getTime(),
          events,
          metrics: {
            ...emptyMetrics(),
            costUsd: restoredCost,
            turns: typeof diskMetrics.turns === "number" ? diskMetrics.turns : 0,
            toolCalls: typeof diskMetrics.toolCalls === "number" ? diskMetrics.toolCalls : 0,
            durationMs: typeof diskMetrics.durationMs === "number" ? diskMetrics.durationMs : 0,
            contextTokens: restoredCtx.contextTokens,
            contextMax: restoredCtx.contextMax,
            contextUsage: restoredCtx,
          },
          pendingRequest: null,
          answeredRequests: buildAnsweredRequests(events, true),
          ...(restoredPrompt ? { systemPrompt: restoredPrompt } : {}),
        });
      }

      // Also add cost from in-memory sessions not in the backend list
      // (shouldn't happen normally, but be safe)
      for (const [sid, session] of s.sessions) {
        if (!all.find((e) => e.bonsaiSid === sid)) {
          totalProjectCost += session.metrics.costUsd;
        }
      }

      // Auto-activate the most relevant session if none is active yet:
      // prefer running → then most recently started active session.
      const currentActiveId = s.activeSessionId;
      let autoActiveId: string | null = currentActiveId;
      if (!currentActiveId) {
        const activeCandidates = all.filter((e) => e.active);
        const running = activeCandidates.find((e) => e.status === "running");
        const best = running ?? activeCandidates.sort(
          (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        )[0];
        autoActiveId = best?.bonsaiSid ?? null;
      }

      // Open tabs for all loaded sessions (they had tabs before the refresh)
      const tabs = new Set(s.openTabs);
      for (const result of results) {
        if (result.status === "fulfilled") {
          tabs.add(result.value.entry.bonsaiSid);
        }
      }

      return {
        sessions: next,
        openTabs: tabs,
        projectCost: totalProjectCost,
        activeSessionId: autoActiveId,
        sessionCounter: Math.max(s.sessionCounter, all.length),
      };
    });
  },

  syncSessionStatuses: async () => {
    const sessions = get().sessions;
    // Collect sessions in transient states that need checking
    const toCheck: string[] = [];
    for (const [sid, session] of sessions) {
      if (session.status === "initializing" || session.status === "running" || session.status === "waiting") {
        toCheck.push(sid);
      }
    }
    if (toCheck.length === 0) return;

    const api = createAgentApi(getClient());
    await Promise.allSettled(
      toCheck.map(async (bonsaiSid) => {
        try {
          const task = await api.status(bonsaiSid);
          const backendStatus = task.status; // "initializing" | "idle" | "running" | "waiting" | "done" | "error"
          const session = get().sessions.get(bonsaiSid);
          if (!session) return;

          // Map backend TaskStatus to frontend SessionStatus
          // Backend "idle" means the turn finished → frontend should be "idle"
          // Backend "done" → frontend "done"
          // Backend "error" → frontend "error"
          // Backend "running" → keep current frontend status (still in progress)
          if (backendStatus === "running") return; // still running, no update needed

          if (session.status !== backendStatus) {
            console.log(`[syncSessionStatuses] ${bonsaiSid}: ${session.status} → ${backendStatus}`);
            set((s) => {
              const current = s.sessions.get(bonsaiSid);
              if (!current) return s;
              // Don't overwrite if status already changed (e.g., event arrived)
              if (current.status !== "initializing" && current.status !== "running" && current.status !== "waiting") return s;
              const next = new Map(s.sessions);
              next.set(bonsaiSid, {
                ...current,
                status: backendStatus as SessionStatus,
                pendingRequest: backendStatus === "idle" || backendStatus === "done" ? null : current.pendingRequest,
              });
              return { sessions: next };
            });
          }
        } catch (err: unknown) {
          // Distinguish JSON-RPC errors (task genuinely not found) from
          // network/timeout errors (transient — leave status unchanged).
          const isRpcError = err && typeof err === "object" && "code" in err;
          if (isRpcError) {
            const session = get().sessions.get(bonsaiSid);
            if (!session) return;
            // Grace period: don't mark as done if session entered initializing < 10s ago
            // to avoid racing with continueSession (backend task not yet created).
            const isRecent = session.status === "initializing" && (Date.now() - session.startedAt) < 10_000;
            if (!isRecent && (session.status === "initializing" || session.status === "running" || session.status === "waiting")) {
              console.log(`[syncSessionStatuses] ${bonsaiSid}: task not found, marking done`);
              set((s) => {
                const current = s.sessions.get(bonsaiSid);
                if (!current) return s;
                if (current.status !== "initializing" && current.status !== "running" && current.status !== "waiting") return s;
                const next = new Map(s.sessions);
                next.set(bonsaiSid, { ...current, status: "done", pendingRequest: null });
                return { sessions: next };
              });
            }
          } else {
            // Network error — leave status unchanged, will retry on next poll
            console.warn(`[syncSessionStatuses] ${bonsaiSid}: network error, skipping`, err);
          }
        }
      }),
    );
  },

  closeSession: (bonsaiSid) => {
    // Close the tab. Live sessions stay in the store (background). No END_SIGNAL.
    set((s) => {
      const session = s.sessions.get(bonsaiSid);
      if (!session) return s;

      const tabs = new Set(s.openTabs);
      tabs.delete(bonsaiSid);

      // Pick next active from remaining open tabs
      const nextActive =
        s.activeSessionId === bonsaiSid
          ? (Array.from(tabs).find((id) => s.sessions.has(id)) ?? null)
          : s.activeSessionId;

      // Terminal sessions: remove from store and archive
      if (session.status === "done" || session.status === "error") {
        const next = new Map(s.sessions);
        next.delete(bonsaiSid);
        const nextClosed = new Set(s.closedIds);
        nextClosed.add(bonsaiSid);
        return {
          sessions: next,
          openTabs: tabs,
          activeSessionId: nextActive,
          closedIds: nextClosed,
          archivedSessions: [
            ...s.archivedSessions,
            {
              bonsaiSid: session.bonsaiSid, name: session.name,
              skillId: session.skillId, specIds: session.specIds,
              startedAt: session.startedAt, endedAt: Date.now(),
              result: session.status === "done" ? "done" : "error",
              costUsd: session.metrics.costUsd, turns: session.metrics.turns,
              durationMs: session.metrics.durationMs, model: session.model,
              config: { model: session.model, maxTurns: session.maxTurns, permissionMode: session.permissionMode, streamText: true, betas: session.betas ?? [], effort: session.effort ?? null },
              events: session.events,
            },
          ],
        };
      }

      // Live sessions: just remove from openTabs, stay in sessions map
      return { openTabs: tabs, activeSessionId: nextActive };
    });
  },

  deleteSession: async (bonsaiSid) => {
    const { createSessionApi } = await import("@/api/methods/sessions.ts");
    const api = createSessionApi(getClient());
    await api.delete(bonsaiSid);
    // Close tab (handles activeSessionId switching)
    get().closeSession(bonsaiSid);
    // Remove from sessions map and ignore late-arriving events
    set((s) => {
      const sessions = new Map(s.sessions);
      sessions.delete(bonsaiSid);
      const closedIds = new Set(s.closedIds);
      closedIds.add(bonsaiSid);
      return { sessions, closedIds };
    });
  },

  endSession: async (bonsaiSid) => {
    const api = createAgentApi(getClient());
    await api.end(bonsaiSid);
  },

  openTab: (bonsaiSid) => {
    set((s) => {
      if (!s.sessions.has(bonsaiSid)) return s;
      const tabs = new Set(s.openTabs);
      tabs.add(bonsaiSid);
      return { openTabs: tabs, activeSessionId: bonsaiSid };
    });
  },

  focusSession: (bonsaiSid) => {
    const session = get().sessions.get(bonsaiSid);
    if (!session) return;

    useFileStore.setState({ activeFilePath: null, previewFilePath: null, previewFile: null });

    if (session.metaTicketId) {
      useBoardStore.getState().openTicket(session.metaTicketId);
    } else {
      useBoardStore.setState({ activeTicketId: null });
    }

    set((s) => {
      const tabs = new Set(s.openTabs);
      tabs.add(bonsaiSid);
      return { openTabs: tabs, activeSessionId: bonsaiSid };
    });
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
    });

    // Mark request as answered, clear pendingRequest, and restore running status.
    // The backend stays in "running" throughout the turn — only the frontend
    // shows "waiting" while the user answers. Setting "running" here is correct
    // state sync (not optimism), since the backend never left "running".
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
      if (t.bonsaiSid === bonsaiSid && (t.eventType === "question" || t.eventType === "approval" || t.eventType === "suggestion")) {
        ns.dismissToast(t.id);
      }
    }
    ns.clearBadge(bonsaiSid);
  },

  updateConfig: async (bonsaiSid, config) => {
    const api = createAgentApi(getClient());
    await api.updateConfig(bonsaiSid, config);
  },

  restartSession: async (bonsaiSid) => {
    const { createSessionApi } = await import("@/api/methods/sessions.ts");
    const api = createSessionApi(getClient());
    await api.restart(bonsaiSid);
    // Backend creates a new session starting in initializing
    set((s) => {
      const session = s.sessions.get(bonsaiSid);
      if (!session) return s;
      const next = new Map(s.sessions);
      const cu = session.metrics.contextUsage;
      next.set(bonsaiSid, {
        ...session,
        status: "initializing",
        pendingRequest: null,
        metrics: {
          ...session.metrics,
          contextUsage: {
            ...cu,
            runBoundaries: [...cu.runBoundaries, cu.turnHistory.length],
          },
        },
      });
      return { sessions: next };
    });
  },

  onConfigChanged: (params) => {
    const bonsaiSid = params.bonsaiSid as string;
    set((s) => {
      const session = s.sessions.get(bonsaiSid);
      if (!session) return s;
      const newModel = (params.model as string) ?? session.model;
      const newBetas = (params.betas as string[]) ?? session.betas;
      const contextMax = getContextWindowSize(newModel);
      const next = new Map(s.sessions);
      next.set(bonsaiSid, {
        ...session,
        model: newModel,
        permissionMode: (params.permissionMode as string) ?? session.permissionMode,
        betas: newBetas,
        effort: (params.effort as string | null) ?? session.effort,
        metrics: {
          ...session.metrics,
          contextMax,
          contextUsage: { ...session.metrics.contextUsage, contextMax },
        },
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
      const cu = session.metrics.contextUsage;
      next.set(bonsaiSid, {
        ...session,
        status: session.status === "initializing" || session.status === "idle" ? "running" : session.status,
        model: (params.model as string) ?? session.model,
        systemPrompt: (params.systemPrompt as string) ?? undefined,
        events: [
          ...session.events,
          {
            bonsaiSid,
            sessionId: (params.sessionId as string) ?? "",
            eventType: "sessionStart",
            payload: params,
          },
        ],
        metrics: {
          ...session.metrics,
          contextUsage: {
            ...cu,
            runBoundaries: [...cu.runBoundaries, cu.turnHistory.length],
          },
        },
      });
      return { sessions: next };
    });
  },

  onAgentEvent: (method, params) => {
    const bonsaiSid = params.bonsaiSid as string;
    // Capture before set() — applyMetrics clears pendingRequest inside the setter.
    const hadPending = get().sessions.get(bonsaiSid)?.pendingRequest != null;
    set((s) => {
      const sessions = appendEvent(s.sessions, bonsaiSid, method, params, s.closedIds);
      let session = sessions.get(bonsaiSid);
      let projectCost = s.projectCost;
      if (session) {
        // Belt-and-suspenders: if we receive work events while idle, transition
        // to running.  Catches the case where agent/statusChanged was missed
        // (e.g. during a WebSocket reconnect).
        if (session.status === "idle") {
          if (_RUNNING_SIGNALS.has(method)) {
            const updated = { ...session, status: "running" as SessionStatus };
            sessions.set(bonsaiSid, updated);
            session = updated;
          }
        }

        if (method === "agent/ready") {
          if (session.status === "initializing") {
            sessions.set(bonsaiSid, { ...session, status: "idle" });
          }
        } else if (method === "agent/costEstimate") {
          const est = params.estimatedCostUsd as number;
          // Context from latest iteration (not cumulative turn totals)
          const contextTokens = (params.currentContextWindow as number) ?? 0;
          const iterInput = (params.iterInputTokens as number) ?? 0;
          const iterCacheRead = (params.iterCacheRead as number) ?? 0;
          const iterCacheCreate = (params.iterCacheCreate as number) ?? 0;
          const iterOutput = (params.iterOutputTokens as number) ?? 0;
          const contextMax = getContextWindowSize(session.model);

          const next = new Map(sessions);
          next.set(bonsaiSid, {
            ...session,
            metrics: {
              ...session.metrics,
              costUsd: typeof est === "number" ? est : session.metrics.costUsd,
              contextTokens,
              contextMax,
              contextUsage: {
                ...session.metrics.contextUsage,
                contextMax,
                contextTokens,
                inputTokens: iterInput,
                cacheReadTokens: iterCacheRead,
                cacheCreationTokens: iterCacheCreate,
                outputTokens: iterOutput,
              },
            },
          });
          return { sessions: next, projectCost };
        } else if (method === "agent/turnComplete" || method === "agent/interrupted") {
          const { updated, costDelta } = applyMetrics(session, params, "idle");
          projectCost += costDelta;

          if (method === "agent/interrupted" && session.pendingRequest) {
            const rid = session.pendingRequest.requestId;
            // Only mark as denied if user has NOT already answered this request.
            // Race: user clicks Approve (resolveRequest sets answeredRequests),
            // then agent/interrupted arrives — don't clobber the user's answer.
            if (!updated.answeredRequests.has(rid)) {
              const answered = new Map(updated.answeredRequests);
              answered.set(rid, {
                behavior: "deny",
                message: "Interrupted",
                interrupt: true,
              });
              updated.answeredRequests = answered;
            }
          }

          sessions.set(bonsaiSid, updated);
        } else if (method === "agent/statusChanged") {
          const newStatus = params.status as SessionStatus;
          // Apply backend status unless frontend is in a frontend-only state
          // ("waiting" is set locally by onAskQuestion/onConfirmAction) or a
          // terminal state that should only change via onSessionDone/onSessionError.
          if (
            session.status !== newStatus &&
            session.status !== "waiting" &&
            session.status !== "done" &&
            session.status !== "error"
          ) {
            sessions.set(bonsaiSid, { ...session, status: newStatus });
          }
        }
      }
      return { sessions, projectCost };
    });

    // Clean up notifications when interrupted during a pending request.
    // Only decrement if there was actually a pending request — otherwise
    // the counter goes negative.  hadPending is captured before set() above
    // because applyMetrics clears pendingRequest inside the setter.
    if (method === "agent/interrupted") {
      if (hadPending) {
        const ns = useNotificationStore.getState();
        ns.decrementPendingInput();
        for (const t of ns.toasts) {
          if (
            t.bonsaiSid === bonsaiSid &&
            (t.eventType === "question" || t.eventType === "approval" || t.eventType === "suggestion")
          ) {
            ns.dismissToast(t.id);
          }
        }
        ns.clearBadge(bonsaiSid);
      }
    }
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

  onSuggestSession: (params) => {
    const bonsaiSid = params.bonsaiSid as string;
    const requestId = params.requestId as string;
    set((s) => {
      const sessions = appendEvent(
        s.sessions,
        bonsaiSid,
        "agent/suggestSession",
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
            type: "suggestion",
            skill: params.skill as string,
            specIds: (params.specIds as string[]) ?? [],
            name: params.name as string,
            reason: params.reason as string,
            prompt: (params.prompt as string) ?? undefined,
          },
        });
      }
      return { sessions };
    });
  },

  onSuggestDescription: (params) => {
    const bonsaiSid = params.bonsaiSid as string;
    const requestId = params.requestId as string;
    set((s) => {
      const sessions = appendEvent(
        s.sessions,
        bonsaiSid,
        "agent/suggestDescription",
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
            type: "description-suggestion",
            description: params.description as string,
            section: (params.section as string) ?? "full",
          },
        });
      }
      return { sessions };
    });
  },

  onSuggestStep: (params) => {
    const bonsaiSid = params.bonsaiSid as string;
    const requestId = params.requestId as string;
    set((s) => {
      const sessions = appendEvent(
        s.sessions,
        bonsaiSid,
        "agent/suggestStep",
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
            type: "step-proposal",
            ticketId: params.ticketId as string,
            stepNumber: params.stepNumber as number,
            stepTitle: params.stepTitle as string,
            skill: params.skill as string,
            inputSpecIds: (params.inputSpecIds as string[]) ?? [],
            reason: params.reason as string,
          },
        });
      }
      return { sessions };
    });
  },

  onSessionDone: (params) => {
    const bonsaiSid = params.bonsaiSid as string;
    set((s) => {
      const sessions = appendEvent(s.sessions, bonsaiSid, "agent/done", params, s.closedIds);
      const session = sessions.get(bonsaiSid);
      let projectCost = s.projectCost;
      if (session) {
        // agent/done carries no usage/context data — only update
        // cost, status, and duration.  Preserve context from the
        // last turnComplete so the display doesn't blank out.
        const newCost = (params.costUsd as number) ?? session.metrics.costUsd;
        const costDelta = newCost - session.metrics.costUsd;
        projectCost += costDelta;
        sessions.set(bonsaiSid, {
          ...session,
          status: "done",
          pendingRequest: null,
          metrics: {
            ...session.metrics,
            costUsd: newCost,
            turns: (params.turns as number) ?? session.metrics.turns,
            durationMs: (params.durationMs as number) ?? session.metrics.durationMs,
          },
        });
      }
      return { sessions, projectCost };
    });
  },

  onSessionError: (params) => {
    const bonsaiSid = params.bonsaiSid as string;
    const subtype = params.subtype as string;
    const isRecoverable = subtype === "turn_error";
    set((s) => {
      const sessions = appendEvent(s.sessions, bonsaiSid, "agent/error", params, s.closedIds);
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

// ── HMR: force full reload when this module changes ──
// Zustand's create() produces a new store instance on each HMR re-execution,
// but wireEvents handlers (registered once in App.tsx) keep closures over the
// OLD store — causing WebSocket-driven updates to be invisible to React.
// accept() makes this module a self-accepting HMR boundary; the callback fires
// only during HMR updates (never on initial load) and forces a clean page load.
if (import.meta.hot) {
  import.meta.hot.accept(() => {
    window.location.reload();
  });
}

// ── Watchdog: polls for stuck sessions every 5 seconds ──

let _watchdogTimer: ReturnType<typeof setInterval> | null = null;

export function startWatchdog(): void {
  if (_watchdogTimer) return;
  _watchdogTimer = setInterval(() => {
    const sessions = useSessionStore.getState().sessions;
    let hasTransient = false;
    for (const session of sessions.values()) {
      if (session.status === "initializing" || session.status === "running" || session.status === "waiting") {
        hasTransient = true;
        break;
      }
    }
    if (hasTransient) {
      useSessionStore.getState().syncSessionStatuses().catch((err) => {
        console.warn("[watchdog] syncSessionStatuses failed:", err);
      });
    }
  }, 5000);
}

export function stopWatchdog(): void {
  if (_watchdogTimer) {
    clearInterval(_watchdogTimer);
    _watchdogTimer = null;
  }
}
