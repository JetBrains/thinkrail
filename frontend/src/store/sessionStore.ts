import { create } from "zustand";
import type { AgentEvent, AgentConfig, SessionArtifact } from "@/types/agent.ts";
import type {
  Session,
  SessionMetrics,
  ContextUsage,
  TurnUsage,
  IterationUsage,
  ArchivedSession,
  PendingRequest,
  SubsessionOrigin,
} from "@/types/session.ts";
import type { SessionSummary } from "@/api/methods/sessions.ts";
import { SessionStatus, SessionReturnStatus, isQuiescent, isTerminal, isTransient } from "@/constants/status.ts";
import { EventType } from "@/constants/eventTypes.ts";
import { getClient } from "@/api/index.ts";
import { createAgentApi } from "@/api/methods/agents.ts";
import { buildDefaultSessionConfig } from "@/utils/sessionConfig.ts";
import { DEFAULT_SESSION_NAME, SAVE_THRESHOLD, deriveSessionName, nonWs, resolveDraftName } from "@/utils/sessionName.ts";
import * as draftAutosave from "./draftAutosave.ts";
import { useInputDraftStore } from "./inputDraftStore.ts";
import { useAnswerDraftStore } from "./answerDraftStore.ts";
import { useNotificationStore } from "./notificationStore.ts";
import { useBoardStore } from "./boardStore.ts";
import { useFileStore } from "./fileStore.ts";
import { useUiStore } from "./uiStore.ts";
import { getErrorMessage } from "@/utils/errors.ts";
import { useSpecStore } from "./specStore.ts";
import { useSettingsStore } from "./settingsStore.ts";
import { findStaleSpecIds, isSkillValid } from "@/utils/staleRefs.ts";

/** Two artifact paths refer to the same file if they're equal OR one is a
 *  suffix of the other (covers legacy entries where one side is absolute and
 *  the other is project-relative).
 */
function _sameArtifactFile(a: string, b: string): boolean {
  return a === b || a.endsWith("/" + b) || b.endsWith("/" + a);
}

/** Collapse an artifact list so the same logical file appears at most once.
 *  When duplicates exist, keep the most-recently-touched entry (or, lacking
 *  timestamps, the last occurrence — which matches the natural append order
 *  used by record_artifact).
 */
function dedupArtifacts(arr: SessionArtifact[]): SessionArtifact[] {
  if (arr.length <= 1) return arr;
  const out: SessionArtifact[] = [];
  for (const item of arr) {
    const existingIdx = out.findIndex((x) => _sameArtifactFile(x.path, item.path));
    if (existingIdx < 0) {
      out.push(item);
      continue;
    }
    const existing = out[existingIdx];
    const newer =
      (item.lastTouchedAt ?? "") >= (existing.lastTouchedAt ?? "")
        ? item
        : existing;
    out[existingIdx] = newer;
  }
  return out;
}

interface SessionStore {
  sessions: Map<string, Session>;
  activeSessionId: string | null;
  archivedSessions: ArchivedSession[];
  /** IDs of sessions explicitly ended by the user — ignore late-arriving events */
  closedIds: Set<string>;
  /** IDs of sessions deleted by the user. Unlike `closedIds` (which also
   *  holds terminal sessions whose tab was merely closed but still exist on
   *  disk), these are gone for good — `refreshSessionList` filters them out
   *  so a slower, stale list response can't resurrect a just-deleted session. */
  deletedIds: Set<string>;
  /** Which sessions have a visible tab in the tab bar */
  openTabs: Set<string>;
  /** Last-fetched session/list response — shared between SessionManager and StatusBar */
  sessionList: SessionSummary[];
  /** Refresh `sessionList` from the backend. Idempotent. */
  refreshSessionList: () => Promise<void>;
  /** Surgical partial update of one entry in `sessionList`. No-op if not present. */
  patchSessionInList: (thinkrailSid: string, patch: Partial<SessionSummary>) => void;

  /** Create a draft session with sensible defaults. Used by + New, Cmd+T, palette. */
  createNewSession: (prefill?: {
    skillId?: string;
    specIds?: string[];
    name?: string;
    ticketId?: string;
  }) => Promise<string>;

  startSession: (params: {
    specIds: string[];
    config: AgentConfig;
    name: string;
    skillId?: string;
    prompt?: string;
    ticketId?: string;
    /** Marks the session as a stage-default (auto-spawned by the ticket view). */
    kind?: "stage-default";
  }) => Promise<string>;
  createDraft: (params: {
    specIds: string[];
    config: AgentConfig;
    name: string;
    skillId?: string;
    prompt?: string;
    ticketId?: string;
    filePaths?: string[];
    /** Marks the draft as a stage-default (auto-spawned by the ticket view). */
    kind?: "stage-default";
  }) => Promise<string>;
  updateDraft: (thinkrailSid: string, changes: {
    specIds?: string[];
    filePaths?: string[];
    skillId?: string | null;
    config?: AgentConfig;
    prompt?: string | null;
    name?: string;
    ticketId?: string | null;
    subagentMode?: "step-session" | "subagent";
    stepGate?: "approve" | "autonomous";
  }) => Promise<string>;
  startDraft: (thinkrailSid: string, prompt?: string) => Promise<void>;
  /** Called by InputArea on each keystroke (after inputDraftStore.setDraft).
   *  Live-derives the tab name and arms the autosave controller once the
   *  prompt crosses the save threshold (or the draft is already saved). */
  noteDraftInput: (thinkrailSid: string, text: string) => void;
  /** Persist an `unsaved` draft via `agent/prepare`, reusing the minted id.
   *  Single-flight: concurrent callers share one in-flight save. Resolves
   *  immediately if already saved. */
  ensureSaved: (thinkrailSid: string) => Promise<void>;
  /** Autosave commit target wired into `draftAutosave`: first persist for an
   *  `unsaved` draft, otherwise an `agent/updateDraft` of the typed text. */
  commitDraft: (thinkrailSid: string) => Promise<void>;
  /** Rename a draft by hand. Freezes live name derivation permanently. */
  renameDraft: (thinkrailSid: string, name: string) => Promise<void>;
  sendMessage: (thinkrailSid: string, text: string, isMarkdown?: boolean) => Promise<void>;
  switchSession: (thinkrailSid: string) => void;
  closeSession: (thinkrailSid: string) => void;
  /** Delete/trash a session: calls backend API, closes tab, removes from store */
  deleteSession: (thinkrailSid: string) => Promise<void>;
  /** Drop every session attached to a ticket from local state (sessions map,
   *  open tabs, cached list). Called when the ticket is deleted — the backend
   *  cascade-trashes the same sessions, so this just keeps the UI in sync. */
  removeSessionsForTicket: (ticketId: string) => void;
  endSession: (thinkrailSid: string) => Promise<void>;
  /** Open a tab for a session (e.g., from background indicator dropdown).
   *  `allowTicketTab` lets a ticket-attached session open as its own tab
   *  instead of rerouting to the ticket view (explicit user opens). */
  openTab: (thinkrailSid: string, opts?: { allowTicketTab?: boolean }) => void;
  /** Ticket-aware focus: opens tab, navigates to ticket if linked, clears conflicting state */
  focusSession: (thinkrailSid: string, opts?: { allowTicketTab?: boolean }) => void;
  /** Check if a session references specs or skills that no longer exist */
  getStaleSessionRefs: (thinkrailSid: string) => { staleSpecIds: string[]; staleSkillId: boolean } | null;
  /** Remove stale spec/skill references from a draft session */
  fixStaleSessionRefs: (thinkrailSid: string) => Promise<void>;
  interruptSession: (thinkrailSid: string) => Promise<void>;
  resolveRequest: (
    thinkrailSid: string,
    requestId: string,
    response: unknown,
  ) => void;

  updateConfig: (thinkrailSid: string, config: { model?: string; permissionMode?: string; effort?: string }) => Promise<void>;
  restartSession: (thinkrailSid: string) => Promise<void>;

  continueSession: (thinkrailSid: string) => Promise<void>;
  retryLastMessage: (thinkrailSid: string) => Promise<void>;
  restoreSession: (thinkrailSid: string, opts?: { noTab?: boolean; allowTicketTab?: boolean }) => Promise<void>;
  loadActiveSessions: (opts?: { includeRecentDiskSession?: boolean }) => Promise<void>;

  // Subsession actions
  createSubsession: (parentThinkrailSid: string, type: "discussion" | "refinement", context?: string, name?: string, origin?: SubsessionOrigin) => Promise<string>;
  requestReturnSummary: (thinkrailSid: string) => Promise<void>;
  approveReturn: (thinkrailSid: string, text: string) => Promise<void>;
  dismissReturn: (thinkrailSid: string) => Promise<void>;
  reviseReturn: (thinkrailSid: string, feedback: string) => Promise<void>;

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
  onSetPreviewFile: (params: Record<string, unknown>) => void;
  onClearPreviewFile: (params: Record<string, unknown>) => void;
  onArtifactAdded: (params: Record<string, unknown>) => void;
  onArtifactLabeled: (params: Record<string, unknown>) => void;
  setPreviewPath: (thinkrailSid: string, path: string | null) => void;
  onRequestExpired: (params: Record<string, unknown>) => void;
  onRequestResolved: (params: Record<string, unknown>) => void;
  onRemoteSessionCreated: (params: Record<string, unknown>) => void;
  onRemoteUserMessage: (params: Record<string, unknown>) => void;
  onSessionDone: (params: Record<string, unknown>) => void;
  onSessionError: (params: Record<string, unknown>) => void;
  /** Merge a snapshot of session metadata pushed from the backend (e.g. when
   *  the agent calls SessionFinalize and sets the outcome). */
  onSessionMetadataUpdate: (task: Record<string, unknown>) => void;
  /** Update one action inside the active session outcome and persist via RPC. */
  patchOutcomeAction: (
    thinkrailSid: string,
    actionId: string,
    patch: Record<string, unknown>,
  ) => Promise<void>;
  onConfigChanged: (params: Record<string, unknown>) => void;
  onSubsessionReturned: (params: Record<string, unknown>) => void;
  onSummaryDrafted: (params: Record<string, unknown>) => void;
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
    const ev = events[i];
    if (ev.eventType === EventType.TurnComplete || ev.eventType === EventType.Done) {
      const cost = ev.payload.costUsd;
      if (typeof cost === "number") return cost;
    }
  }
  return 0;
}

/**
 * Reconstruct context usage from persisted events.
 * Scans for turnComplete/interrupted events with usage data and
 * toolCallStart events for tool/file tracking.
 */
function reconstructContextUsage(events: AgentEvent[], fallbackContextMax = 0): ContextUsage {
  const cu = emptyContextUsage();
  // The context window (bar denominator) is streamed by the runtime on each
  // turn-end event; fall back to the last-known persisted value for sessions
  // whose events predate that field.
  cu.contextMax = fallbackContextMax;
  const toolUseIdToName = new Map<string, string>();

  for (const ev of events) {
    // Record run boundaries from sessionStart events
    if (ev.eventType === EventType.SessionStart) {
      cu.runBoundaries.push(cu.turnHistory.length);
    }

    // Accumulate turn usage from turnComplete/interrupted events
    if (ev.eventType === EventType.TurnComplete || ev.eventType === EventType.Interrupted) {
      const p = ev.payload;
      if (!p.usage) continue;
      // usage and iterations use dict[str, Any] on the backend, so values are unknown.
      const usage = p.usage as Record<string, number>;

      // Per-iteration data (new events carry this array)
      const rawIters = (p.iterations ?? []) as Record<string, unknown>[];
      const lastIter = rawIters.length > 0 ? rawIters[rawIters.length - 1] : null;

      // All breakdown values from last iteration so they add up:
      // inputTokens (fresh) + cacheRead + cacheCreate + output = contextTokens.
      const inputTokens = lastIter ? ((lastIter.input_tokens as number) ?? 0) : (usage.input_tokens ?? 0);
      const cacheCreation = lastIter ? ((lastIter.cache_creation_input_tokens as number) ?? 0) : (usage.cache_creation_input_tokens ?? 0);
      const cacheRead = lastIter ? ((lastIter.cache_read_input_tokens as number) ?? 0) : (usage.cache_read_input_tokens ?? 0);
      const outputTokens = lastIter ? ((lastIter.output_tokens as number) ?? 0) : (usage.output_tokens ?? 0);

      // Turn-history row shows cumulative turn totals (summed across iterations);
      // the context breakdown below stays last-iteration for the window bar.
      const sumIters = (key: string): number => rawIters.reduce((s, it) => s + ((it[key] as number) ?? 0), 0);
      const turnInput = rawIters.length > 0 ? sumIters("input_tokens") : (usage.input_tokens ?? 0);
      const turnOutput = rawIters.length > 0 ? sumIters("output_tokens") : (usage.output_tokens ?? 0);
      const turnCacheCreation = rawIters.length > 0 ? sumIters("cache_creation_input_tokens") : (usage.cache_creation_input_tokens ?? 0);
      const turnCacheRead = rawIters.length > 0 ? sumIters("cache_read_input_tokens") : (usage.cache_read_input_tokens ?? 0);

      const totalContext = (p.contextWindow ?? 0) || (inputTokens + cacheCreation + cacheRead + outputTokens);

      cu.contextTokens = totalContext;
      cu.outputTokens = outputTokens;
      cu.inputTokens = inputTokens;
      cu.cacheReadTokens = cacheRead;
      cu.cacheCreationTokens = cacheCreation;

      // Runtime-streamed model context window (bar denominator); last turn wins.
      const turnContextMax = p.contextMax as number | undefined;
      if (typeof turnContextMax === "number" && turnContextMax > 0) {
        cu.contextMax = turnContextMax;
      }

      // Convert raw iterations to typed IterationUsage[]
      const iterations: IterationUsage[] = rawIters.map((it) => {
        const cc = it.cache_creation as Record<string, number> | null | undefined;
        return {
          type: it.type === "compaction" ? "compaction" as const : "message" as const,
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
        inputTokens: turnInput,
        outputTokens: turnOutput,
        cacheCreationTokens: turnCacheCreation,
        cacheReadTokens: turnCacheRead,
        totalContextTokens: totalContext,
        costUsd: p.turnCostUsd ?? 0,
        timestamp: 0, // not available from persisted events
        sdkTurns: p.turnTurns ?? 1,
        iterations: iterations.length > 0 ? iterations : undefined,
      });
    }

    // Track tool calls and files
    if (ev.eventType === EventType.ToolCallStart) {
      const p = ev.payload;
      const toolName = p.toolName ?? "";
      const toolUseId = p.toolUseId ?? "";
      cu.toolCallCounts[toolName] = (cu.toolCallCounts[toolName] ?? 0) + 1;

      if (toolUseId) toolUseIdToName.set(toolUseId, toolName);

      const toolInput = (p.toolInput ?? {}) as Record<string, unknown>;

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
    if (ev.eventType === EventType.ToolCallEnd) {
      const p = ev.payload;
      const toolUseId = p.toolUseId ?? "";
      const toolName = toolUseIdToName.get(toolUseId) ?? "";
      if (toolName) {
        const output = p.output ?? "";
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
 * updated session.
 */
function applyMetrics(
  session: Session,
  params: Record<string, unknown>,
  status: SessionStatus,
): Session {
  const newCost = (params.costUsd as number) ?? session.metrics.costUsd;

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

  // Turn-history row shows cumulative turn totals (summed across iterations) so
  // input/output grow monotonically with the cost; the breakdown above stays
  // last-iteration for the context-window bar.
  const sumIters = (key: string): number => rawIters.reduce((s, it) => s + (it[key] ?? 0), 0);
  const turnInput = rawIters.length > 0 ? sumIters("input_tokens") : (usage.input_tokens ?? 0);
  const turnOutput = rawIters.length > 0 ? sumIters("output_tokens") : (usage.output_tokens ?? 0);
  const turnCacheCreation = rawIters.length > 0 ? sumIters("cache_creation_input_tokens") : (usage.cache_creation_input_tokens ?? 0);
  const turnCacheRead = rawIters.length > 0 ? sumIters("cache_read_input_tokens") : (usage.cache_read_input_tokens ?? 0);

  // Context window = all tokens in the last API call.
  const totalContext = (params.contextWindow as number) || (inputTokens + cacheCreation + cacheRead + outputTokens);
  // Denominator is streamed by the runtime on the turn event; carry the
  // last-known value forward when a given event omits it.
  const contextMax = (params.contextMax as number) || session.metrics.contextMax || 0;

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
    inputTokens: turnInput,
    outputTokens: turnOutput,
    cacheCreationTokens: turnCacheCreation,
    cacheReadTokens: turnCacheRead,
    totalContextTokens: totalContext,
    costUsd: (params.turnCostUsd as number) ?? 0,
    timestamp: Date.now(),
    sdkTurns: (params.turn_turns as number) ?? 1,
    iterations: iterations.length > 0 ? iterations : undefined,
  };

  // If any pending requests are being cleared, mark each as answered
  // so the event cards render correctly (especially in multi-client
  // scenarios where turnComplete may arrive before requestResolved).
  let answeredRequests = session.answeredRequests;
  for (const req of session.pendingRequests) {
    if (!answeredRequests.has(req.requestId)) {
      answeredRequests = new Map(answeredRequests);
      answeredRequests.set(req.requestId, { implicitlyResolved: true });
    }
  }

  return {
    ...session,
    status,
    pendingRequests: [],
    answeredRequests,
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
        liveTurn: null,
      },
    },
  };
}

/**
 * Ensure a session exists in the map. If not, create a placeholder.
 * This handles the race condition where agent events arrive before
 * startSession() finishes creating the Session object.
 */
function ensureSession(
  sessions: Map<string, Session>,
  thinkrailSid: string,
  closedIds?: Set<string>,
): Map<string, Session> {
  if (sessions.has(thinkrailSid)) return sessions;
  if (closedIds?.has(thinkrailSid)) return sessions;
  const next = new Map(sessions);
  next.set(thinkrailSid, {
    thinkrailSid,
    name: thinkrailSid.slice(0, 8),
    skillId: null,
    specIds: [],
    filePaths: [],
    status: SessionStatus.Initializing,
    model: "",
    permissionMode: "default",
    effort: "auto",
    startedAt: Date.now(),
    events: [],
    metrics: emptyMetrics(),
    pendingRequests: [],
    answeredRequests: new Map(),
    parentThinkrailSid: null,
    subsessionType: null,
    subsessionContext: null,
    subsessionOrigin: null,
    returnStatus: null,
    returnSummary: null,
    outcome: null,
    artifacts: [],
    previewPath: null,
    previewSection: null,
  });
  return next;
}

function appendEvent(
  sessions: Map<string, Session>,
  thinkrailSid: string,
  method: string,
  params: Record<string, unknown>,
  closedIds?: Set<string>,
): Map<string, Session> {
  // Skip ephemeral events — costEstimate and statusChanged update state directly,
  // not stored in events history.
  if (method === "agent/costEstimate" || method === "agent/statusChanged") return sessions;
  // Don't create phantom sessions — only update sessions that already exist
  if (!sessions.has(thinkrailSid)) return sessions;
  if (closedIds?.has(thinkrailSid)) return sessions;

  const withSession = ensureSession(sessions, thinkrailSid, closedIds);
  const session = withSession.get(thinkrailSid);
  if (!session) return sessions;

  // Defense-in-depth dedup: skip if an event with the same requestId already exists
  const requestId = params.requestId as string | undefined;
  if (requestId && (method === "agent/askUserQuestion" || method === "agent/confirmAction" || method === "agent/suggestSession" || method === "agent/suggestDescription" || method === "agent/suggestStep")) {
    const alreadyExists = session.events.some(
      (ev) => (ev.payload as unknown as Record<string, unknown> | undefined)?.requestId === requestId && ev.eventType === method.replace("agent/", ""),
    );
    if (alreadyExists) return sessions;
  }

  const event = {
    thinkrailSid,
    sessionId: (params.sessionId as string) ?? "",
    eventType: method.replace("agent/", "") as AgentEvent["eventType"],
    payload: params,
  } as unknown as AgentEvent;

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
        if (ev.eventType === EventType.ToolCallStart && ev.payload?.toolUseId === toolUseId) {
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

  next.set(thinkrailSid, {
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

  // First pass: collect requestResolved and requestExpired events
  for (const ev of events) {
    if (ev.eventType === EventType.RequestResolved) {
      const rid = ev.payload.requestId ?? "";
      if (rid) answered.set(rid, ev.payload.response);
    } else if (ev.eventType === EventType.RequestExpired) {
      const rid = (ev.payload.requestId as string) ?? "";
      if (rid) answered.set(rid, { expired: true, reason: ev.payload.reason });
    }
  }

  // Second pass (non-active only): mark remaining unresolved requests as historical
  if (!isActive) {
    for (const ev of events) {
      if (ev.eventType === EventType.AskUserQuestion || ev.eventType === EventType.ConfirmAction || ev.eventType === EventType.SuggestSession || ev.eventType === EventType.SuggestDescription || ev.eventType === EventType.SuggestStep) {
        const rid = (ev.payload.requestId as string) ?? "";
        if (rid && !answered.has(rid)) answered.set(rid, { historical: true });
      }
    }
  }

  return answered;
}

/** Tracks in-flight restoreSession fetches to prevent duplicate concurrent loads. */
const _restoring = new Set<string>();

/** In-flight `ensureSaved` promises, keyed by thinkrailSid — makes the first
 *  `agent/prepare` single-flight so concurrent triggers create one draft. */
const _saving = new Map<string, Promise<void>>();

/** Tracks which session topics this client is subscribed to (multi-client). */
const _subscribed = new Set<string>();

/** Subscribe to a session's event topic so this client receives live updates.
 *  Safe to call multiple times — deduplicates via _subscribed set. */
function _ensureSubscribed(thinkrailSid: string): void {
  if (_subscribed.has(thinkrailSid)) return;
  _subscribed.add(thinkrailSid);
  import("@/api/methods/sessions.ts").then(({ createSessionApi }) => {
    const api = createSessionApi(getClient());
    api.subscribe(thinkrailSid).catch(() => {
      // Connection not ready or session gone — will retry on next open
      _subscribed.delete(thinkrailSid);
    });
  });
}

/** Streaming events that imply the backend is running (belt-and-suspenders guard). */
const _RUNNING_SIGNALS = new Set(["agent/textDelta", "agent/toolCallStart", "agent/costEstimate"]);

export const useSessionStore = create<SessionStore>((set, get) => ({
  sessions: new Map(),
  activeSessionId: null,
  archivedSessions: [],
  closedIds: new Set(),
  deletedIds: new Set(),
  openTabs: new Set(),
  sessionList: [],

  refreshSessionList: async () => {
    const { createSessionApi } = await import("@/api/methods/sessions.ts");
    const list = await createSessionApi(getClient()).list();
    // Drop entries the user already deleted: a stale, slower list response
    // (e.g. one kicked off before the delete landed) must not re-add them.
    set((s) => ({ sessionList: list.filter((e) => !s.deletedIds.has(e.thinkrailSid)) }));
  },

  patchSessionInList: (thinkrailSid, patch) => {
    set((s) => {
      const idx = s.sessionList.findIndex((e) => e.thinkrailSid === thinkrailSid);
      if (idx === -1) return s;
      const next = [...s.sessionList];
      next[idx] = { ...next[idx], ...patch };
      return { sessionList: next };
    });
  },

  createNewSession: async (prefill) => {
    const state = get();

    // Pre-configured entry points (ticket / stage-default) carry intent at
    // creation — persist immediately, unchanged.
    const carriesIntent =
      !!prefill?.ticketId || (prefill?.specIds?.length ?? 0) > 0 || !!prefill?.skillId;
    if (carriesIntent) {
      const thinkrailSid = await state.createDraft({
        specIds: prefill?.specIds ?? [],
        config: await buildDefaultSessionConfig(),
        name: prefill?.name ?? DEFAULT_SESSION_NAME,
        skillId: prefill?.skillId,
        ticketId: prefill?.ticketId,
      });
      if (!prefill?.ticketId) {
        useUiStore.getState().setCenterView("sessions");
        useBoardStore.setState({ activeTicketId: null });
      }
      return thinkrailSid;
    }

    // No-duplicate-blanks: focus an existing untouched blank `unsaved` tab
    // instead of opening another. Per-client by design.
    const drafts = useInputDraftStore.getState().drafts;
    for (const [sid, session] of state.sessions) {
      if (session.unsaved && nonWs(drafts.get(sid) ?? "") === 0) {
        get().switchSession(sid);
        get().openTab(sid);
        useUiStore.getState().setCenterView("sessions");
        useBoardStore.setState({ activeTicketId: null });
        return sid;
      }
    }

    // Defer: mint client-side, insert an `unsaved` draft, no RPC.
    const thinkrailSid = crypto.randomUUID();
    const config = await buildDefaultSessionConfig();
    set((s) => {
      const next = new Map(s.sessions);
      next.set(thinkrailSid, {
        thinkrailSid,
        name: prefill?.name ?? DEFAULT_SESSION_NAME,
        skillId: prefill?.skillId ?? null,
        specIds: [],
        filePaths: [],
        status: SessionStatus.Draft,
        unsaved: true,
        model: config.model,
        permissionMode: config.permissionMode,
        effort: config.effort ?? "auto",
        flags: config.flags ?? {},
        startedAt: Date.now(),
        events: [],
        metrics: emptyMetrics(),
        pendingRequests: [],
        answeredRequests: new Map(),
        ticketId: null,
        parentThinkrailSid: null,
        subsessionType: null,
        subsessionContext: null,
        subsessionOrigin: null,
        returnStatus: null,
        returnSummary: null,
        artifacts: [],
        previewPath: null,
        previewSection: null,
      });
      const tabs = new Set(s.openTabs);
      tabs.add(thinkrailSid);
      return { sessions: next, openTabs: tabs, activeSessionId: thinkrailSid };
    });
    useUiStore.getState().setCenterView("sessions");
    useBoardStore.setState({ activeTicketId: null });
    return thinkrailSid;
  },

  startSession: async ({ specIds, config, name, skillId, prompt, ticketId, kind }) => {
    const api = createAgentApi(getClient());
    const { thinkrailSid } = await api.run({ specIds, config, skillId: skillId ?? undefined, prompt: prompt ?? undefined, name, ticketId: ticketId ?? undefined });

    set((s) => {
      const next = new Map(s.sessions);
      const existing = next.get(thinkrailSid);
      // Merge with placeholder if events arrived before this resolved.
      // Preserve status if agent/ready already transitioned it past "initializing".
      const resolvedStatus = existing && existing.status !== SessionStatus.Initializing
        ? existing.status
        : SessionStatus.Initializing;
      next.set(thinkrailSid, {
        thinkrailSid,
        name,
        skillId: skillId ?? null,
        specIds,
        filePaths: [],
        status: resolvedStatus,
        model: config.model,
        permissionMode: config.permissionMode,
        effort: config.effort ?? "auto",
        flags: config.flags ?? {},
        startedAt: Date.now(),
        events: existing?.events ?? [],
        metrics: existing?.metrics ?? emptyMetrics(),
        pendingRequests: existing?.pendingRequests ?? [],
        answeredRequests: existing?.answeredRequests ?? new Map(),
        ticketId: ticketId ?? null,
        kind: kind ?? undefined,
        parentThinkrailSid: null,
        subsessionType: null,
        subsessionContext: null,
        subsessionOrigin: null,
        returnStatus: null,
        returnSummary: null,
        artifacts: existing?.artifacts ?? [],
        previewPath: existing?.previewPath ?? null,
        previewSection: existing?.previewSection ?? null,
      });
      if (ticketId) {
        return { sessions: next };
      }
      const tabs = new Set(s.openTabs);
      tabs.add(thinkrailSid);
      return { sessions: next, openTabs: tabs, activeSessionId: thinkrailSid };
    });

    // Clear file viewer so the new session becomes visible immediately
    useFileStore.setState({ activeFilePath: null, previewFilePath: null, previewFile: null });

    return thinkrailSid;
  },

  createDraft: async ({ specIds, config, name, skillId, prompt, ticketId, filePaths, kind }) => {
    const api = createAgentApi(getClient());
    const { thinkrailSid, systemPrompt, sections } = await api.prepare({
      specIds,
      config,
      skillId: skillId ?? undefined,
      prompt: prompt ?? undefined,
      name,
      ticketId: ticketId ?? undefined,
      filePaths: filePaths ?? undefined,
    });

    set((s) => {
      const next = new Map(s.sessions);
      next.set(thinkrailSid, {
        thinkrailSid,
        name,
        // A pre-configured draft's name is intentional, not derived from a
        // typed prompt — freeze derivation so flush/autosave can't relabel it.
        nameManuallySet: !!name && name !== DEFAULT_SESSION_NAME,
        skillId: skillId ?? null,
        specIds,
        filePaths: filePaths ?? [],
        status: SessionStatus.Draft,
        model: config.model,
        permissionMode: config.permissionMode,
        effort: config.effort ?? "auto",
        flags: config.flags ?? {},
        startedAt: Date.now(),
        events: [],
        metrics: emptyMetrics(),
        pendingRequests: [],
        answeredRequests: new Map(),
        ticketId: ticketId ?? null,
        kind: kind ?? undefined,
        systemPrompt,
        promptSections: (sections as Session["promptSections"]) ?? null,
        parentThinkrailSid: null,
        subsessionType: null,
        subsessionContext: null,
        subsessionOrigin: null,
        returnStatus: null,
        returnSummary: null,
        artifacts: [],
        previewPath: null,
        previewSection: null,
      });
      if (ticketId) {
        return { sessions: next };
      }
      const tabs = new Set(s.openTabs);
      tabs.add(thinkrailSid);
      return { sessions: next, openTabs: tabs, activeSessionId: thinkrailSid };
    });

    return thinkrailSid;
  },

  updateDraft: async (thinkrailSid, changes) => {
    // While unsaved (no backend task yet) apply config changes locally and
    // skip the RPC — the first `agent/prepare` carries them on save.
    const current = get().sessions.get(thinkrailSid);
    if (current?.unsaved) {
      set((s) => {
        const session = s.sessions.get(thinkrailSid);
        if (!session) return s;
        const next = new Map(s.sessions);
        next.set(thinkrailSid, {
          ...session,
          ...(changes.specIds !== undefined ? { specIds: changes.specIds } : {}),
          ...(changes.skillId !== undefined ? { skillId: changes.skillId } : {}),
          ...(changes.config ? {
            model: changes.config.model,
            permissionMode: changes.config.permissionMode,
            effort: changes.config.effort ?? "auto",
            flags: changes.config.flags ?? {},
          } : {}),
          ...(changes.name !== undefined ? { name: changes.name } : {}),
          ...(changes.ticketId !== undefined ? { ticketId: changes.ticketId } : {}),
          ...(changes.filePaths !== undefined ? { filePaths: changes.filePaths } : {}),
          ...(changes.subagentMode !== undefined ? { subagentMode: changes.subagentMode } : {}),
          ...(changes.stepGate !== undefined ? { stepGate: changes.stepGate } : {}),
        });
        return { sessions: next };
      });
      return get().sessions.get(thinkrailSid)?.systemPrompt ?? "";
    }

    const api = createAgentApi(getClient());
    const result = await api.updateDraft({
      thinkrailSid,
      ...changes,
    });
    const systemPrompt = result.systemPrompt as string;
    const promptSections = (result.sections as Session["promptSections"]) ?? null;

    set((s) => {
      const session = s.sessions.get(thinkrailSid);
      if (!session || session.status !== SessionStatus.Draft) return s;
      const next = new Map(s.sessions);
      next.set(thinkrailSid, {
        ...session,
        ...(changes.specIds !== undefined ? { specIds: changes.specIds } : {}),
        ...(changes.skillId !== undefined ? { skillId: changes.skillId } : {}),
        ...(changes.config ? {
          model: changes.config.model,
          permissionMode: changes.config.permissionMode,
          effort: changes.config.effort ?? "auto",
          flags: changes.config.flags ?? {},
        } : {}),
        ...(changes.name !== undefined ? { name: changes.name } : {}),
        ...(changes.ticketId !== undefined ? { ticketId: changes.ticketId } : {}),
        ...(changes.filePaths !== undefined ? { filePaths: changes.filePaths } : {}),
        ...(changes.subagentMode !== undefined ? { subagentMode: changes.subagentMode } : {}),
        ...(changes.stepGate !== undefined ? { stepGate: changes.stepGate } : {}),
        systemPrompt,
        promptSections,
      });
      return { sessions: next };
    });

    return systemPrompt;
  },

  startDraft: async (thinkrailSid, prompt) => {
    // Persist first so Start works even below the autosave threshold, and
    // cancel any pending autosave timer (ensureSaved already carries the
    // typed text) so it can't fire a redundant prepare afterwards.
    draftAutosave.cancel(thinkrailSid);
    await get().ensureSaved(thinkrailSid);

    const api = createAgentApi(getClient());
    await api.startDraft(thinkrailSid, prompt);

    set((s) => {
      const session = s.sessions.get(thinkrailSid);
      if (!session) return s;
      // Seed context with system prompt tokens so the counter doesn't start at 0
      const promptTokens = session.promptSections
        ? session.promptSections.reduce((sum, sec) => sum + sec.tokens, 0)
        : 0;
      // Denominator arrives from the runtime on the first turn; carry forward
      // any known value (0 → bar hidden until then).
      const contextMax = session.metrics.contextMax || 0;
      const next = new Map(s.sessions);
      next.set(thinkrailSid, {
        ...session,
        status: SessionStatus.Initializing,
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

  noteDraftInput: (thinkrailSid, text) => {
    const session = get().sessions.get(thinkrailSid);
    if (!session || session.status !== SessionStatus.Draft) return;

    // Live-derive the tab name unless the user renamed by hand. Clearing all
    // text reverts to the default label but never deletes the draft.
    if (!session.nameManuallySet) {
      const name = deriveSessionName(text);
      if (name !== session.name) {
        set((s) => {
          const cur = s.sessions.get(thinkrailSid);
          if (!cur) return s;
          const next = new Map(s.sessions);
          next.set(thinkrailSid, { ...cur, name });
          return { sessions: next };
        });
      }
    }

    // Threshold gating: arm autosave once the prompt crosses the threshold,
    // or unconditionally for an already-saved draft.
    if (nonWs(text) >= SAVE_THRESHOLD || !session.unsaved) {
      draftAutosave.noteInput(thinkrailSid);
    }
  },

  ensureSaved: async (thinkrailSid) => {
    const session = get().sessions.get(thinkrailSid);
    if (!session || !session.unsaved) return;

    const inFlight = _saving.get(thinkrailSid);
    if (inFlight) return inFlight;

    const promise = (async () => {
      const api = createAgentApi(getClient());
      // Re-read inside the async body: config/spec/skill/name edits made
      // between this call and the network dispatch must reach the first save,
      // not be dropped by a snapshot captured at call time.
      const cur = get().sessions.get(thinkrailSid);
      if (!cur) return;
      const draftInput = useInputDraftStore.getState().getDraft(thinkrailSid);
      const name = cur.nameManuallySet ? cur.name : deriveSessionName(draftInput);
      const config: AgentConfig = {
        model: cur.model,
        permissionMode: cur.permissionMode,
        streamText: true,
        effort: cur.effort,
        flags: cur.flags ?? {},
      };
      const { systemPrompt, sections } = await api.prepare({
        thinkrailSid,
        specIds: cur.specIds,
        config,
        skillId: cur.skillId ?? undefined,
        name,
        draftInput: draftInput || undefined,
      });
      set((s) => {
        const cur = s.sessions.get(thinkrailSid);
        if (!cur) return s;
        const next = new Map(s.sessions);
        next.set(thinkrailSid, {
          ...cur,
          unsaved: false,
          name: cur.nameManuallySet ? cur.name : name,
          systemPrompt,
          promptSections: (sections as Session["promptSections"]) ?? cur.promptSections ?? null,
        });
        return { sessions: next };
      });
    })();

    _saving.set(thinkrailSid, promise);
    try {
      await promise;
    } finally {
      _saving.delete(thinkrailSid);
    }
  },

  commitDraft: async (thinkrailSid) => {
    const session = get().sessions.get(thinkrailSid);
    if (!session || session.status !== SessionStatus.Draft) return;

    try {
      if (session.unsaved) {
        // Autosave/flush must leave no trace for a sub-threshold blank: abandoning
        // a 2–3 char draft on blur/page-hide should never persist. Start/Send go
        // through ensureSaved directly, so they still start below the threshold.
        const draftInput = useInputDraftStore.getState().getDraft(thinkrailSid);
        if (nonWs(draftInput) < SAVE_THRESHOLD) return;
        await get().ensureSaved(thinkrailSid);
        return;
      }

      const api = createAgentApi(getClient());
      // Re-read so a rename landing between this call and dispatch isn't lost.
      // The label is maintained live by noteDraftInput/renameDraft, so persist
      // it as-is rather than re-deriving (which would mislabel a pre-configured
      // draft whose input is empty but whose name is meaningful).
      const cur = get().sessions.get(thinkrailSid);
      if (!cur) return;
      const draftInput = useInputDraftStore.getState().getDraft(thinkrailSid);
      await api.updateDraft({ thinkrailSid, draftInput, name: cur.name });
    } catch (err) {
      // Autosave is best-effort: the typed text stays in inputDraftStore and the
      // next keystroke re-arms a save, so surface a non-fatal toast rather than
      // throw into the timer/flush callers.
      useNotificationStore.getState().addToast({
        eventType: "error",
        message: `Couldn't save draft: ${getErrorMessage(err)}`,
        persistent: false,
        thinkrailSid,
      });
    }
  },

  renameDraft: async (thinkrailSid, name) => {
    const session = get().sessions.get(thinkrailSid);
    if (!session) return;
    set((s) => {
      const cur = s.sessions.get(thinkrailSid);
      if (!cur) return s;
      const next = new Map(s.sessions);
      next.set(thinkrailSid, { ...cur, name, nameManuallySet: true });
      return { sessions: next };
    });
    // Saved drafts persist the new label through the autosave debounce (its
    // commit sends the current name), so per-keystroke renaming is one RPC,
    // not one per character. Unsaved ones stay local until the first save.
    if (!session.unsaved) draftAutosave.noteInput(thinkrailSid);
  },

  sendMessage: async (thinkrailSid, text, isMarkdown) => {
    // If session is in draft status, auto-start it with this message.
    // Start the session first (sessionStart event arrives via WebSocket during
    // the RPC call), then add the userMessage so it appears after the config card.
    const session = get().sessions.get(thinkrailSid);
    if (session?.status === SessionStatus.Draft) {
      try {
        await get().startDraft(thinkrailSid, text);
      } catch (err) {
        // Start failed before the runner launched. handleSend already cleared
        // the input optimistically — restore it so the typed text isn't lost,
        // and don't append the optimistic userMessage.
        useInputDraftStore.getState().setDraft(thinkrailSid, text);
        useNotificationStore.getState().addToast({
          eventType: "error",
          message: `Couldn't start session: ${getErrorMessage(err)}`,
          persistent: true,
          thinkrailSid,
        });
        return;
      }
      set((s) => {
        const sess = s.sessions.get(thinkrailSid);
        if (!sess) return s;
        const next = new Map(s.sessions);
        next.set(thinkrailSid, {
          ...sess,
          events: [
            ...sess.events,
            {
              thinkrailSid,
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
      const session = s.sessions.get(thinkrailSid);
      if (!session) return s;
      const next = new Map(s.sessions);
      next.set(thinkrailSid, {
        ...session,
        events: [
          ...session.events,
          {
            thinkrailSid,
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
      await api.send(thinkrailSid, text, isMarkdown);
    } catch (err) {
      console.error("[sendMessage] failed:", err);
      const msg = getErrorMessage(err);
      useNotificationStore.getState().addToast({
        eventType: "error",
        message: `Send failed: ${msg}`,
        persistent: true,
        thinkrailSid,
      });
      // Remove optimistic userMessage on failure
      set((s) => {
        const session = s.sessions.get(thinkrailSid);
        if (!session) return s;
        const next = new Map(s.sessions);
        next.set(thinkrailSid, {
          ...session,
          events: session.events.filter(
            (e, i) =>
              !(
                e.eventType === EventType.UserMessage &&
                i === session.events.length - 1 &&
                (e.payload.text as string) === text
              ),
          ),
        });
        return { sessions: next };
      });
    }
  },

  switchSession: (thinkrailSid) => {
    const prev = get().activeSessionId;
    if (prev && prev !== thinkrailSid && get().sessions.get(prev)?.status === SessionStatus.Draft) {
      void draftAutosave.flush(prev);
    }
    _ensureSubscribed(thinkrailSid);
    set({ activeSessionId: thinkrailSid });
  },

  continueSession: async (thinkrailSid) => {
    const { createSessionApi } = await import("@/api/methods/sessions.ts");
    const api = createSessionApi(getClient());
    await api.continue(thinkrailSid);

    // If session is in memory, just update it
    if (get().sessions.has(thinkrailSid)) {
      set((s) => {
        const session = s.sessions.get(thinkrailSid);
        if (!session) return s;

        // Reconstruct answered requests, marking unresolved as historical
        const answered = buildAnsweredRequests(session.events, false);

        const next = new Map(s.sessions);
        next.set(thinkrailSid, {
          ...session,
          status: SessionStatus.Initializing,
          restored: undefined,
          pendingRequests: [],
          answeredRequests: answered,
        });
        // Ticket-attached sessions don't get a SessionPanel tab — they
        // live exclusively under the ticket view.
        if (session.ticketId) {
          return { sessions: next };
        }
        const tabs = new Set(s.openTabs);
        tabs.add(thinkrailSid);
        return { sessions: next, openTabs: tabs, activeSessionId: thinkrailSid };
      });
    } else {
      // Session NOT in memory — restore first without forcing a tab; the
      // set below adds one only for non-ticket sessions.
      await get().restoreSession(thinkrailSid, { noTab: true });
      set((s) => {
        const session = s.sessions.get(thinkrailSid);
        if (!session) return s;
        const next = new Map(s.sessions);
        next.set(thinkrailSid, { ...session, status: SessionStatus.Initializing, restored: undefined });
        if (session.ticketId) {
          return { sessions: next };
        }
        const tabs = new Set(s.openTabs);
        tabs.add(thinkrailSid);
        return { sessions: next, openTabs: tabs };
      });
    }
  },

  retryLastMessage: async (thinkrailSid) => {
    try {
      const api = createAgentApi(getClient());
      await api.retryLastMessage(thinkrailSid);
    } catch (err) {
      console.error("retryLastMessage failed:", err);
    }
  },

  restoreSession: async (thinkrailSid, opts) => {
    const noTab = opts?.noTab ?? false;
    const allowTicketTab = opts?.allowTicketTab ?? false;
    // Subscribe to live events for this session (multi-client)
    _ensureSubscribed(thinkrailSid);
    // Already in memory or already being restored — just open tab if needed
    if (get().sessions.has(thinkrailSid) || _restoring.has(thinkrailSid)) {
      const existing = get().sessions.get(thinkrailSid);
      // Ticket-attached sessions never become free-standing tabs unless the
      // caller explicitly opts in.
      if (existing?.ticketId && !allowTicketTab) return;
      if (!noTab) {
        set((s) => {
          const tabs = new Set(s.openTabs);
          tabs.add(thinkrailSid);
          return { openTabs: tabs, activeSessionId: thinkrailSid };
        });
        if (allowTicketTab) useBoardStore.setState({ activeTicketId: null });
      }
      return;
    }
    // Load from backend (guard against concurrent fetches)
    _restoring.add(thinkrailSid);
    try {
    const { createSessionApi } = await import("@/api/methods/sessions.ts");
    const api = createSessionApi(getClient());
    const data = await api.get(thinkrailSid);
    console.log("[restoreSession]", thinkrailSid, "data:", data ? `${(data.events ?? []).length} events` : "null");
    if (!data) return;

    // Check if this session has a live backend runner
    const allSessions = await api.list();
    const backendEntry = allSessions.find((s) => s.thinkrailSid === thinkrailSid);
    const isActive = backendEntry?.active === true;

    // Convert backend events to AgentEvent format
    const events: AgentEvent[] = (data.events ?? []).map((ev: Record<string, unknown>) => ({
      thinkrailSid,
      sessionId: ((ev.payload as Record<string, unknown>)?.sessionId as string) ?? "",
      eventType: ((ev.eventType as string) ?? "notification") as AgentEvent["eventType"],
      payload: (ev.payload as Record<string, unknown>) ?? ev,
    } as unknown as AgentEvent));

    // Reconstruct answered requests from persisted events
    const answered = buildAnsweredRequests(events, isActive);

    const restoredCost = reconstructCost(events);
    const restoredModel = (data.config?.model as string) ?? "";
    const diskMetrics = (data?.metrics ?? {}) as Record<string, unknown>;
    const restoredCtx = reconstructContextUsage(events, (diskMetrics.contextMax as number) ?? 0);

    // Restore system prompt from sessionStart event payload
    const restoredPrompt = events.find((e) => e.eventType === EventType.SessionStart)?.payload.systemPrompt as string | undefined;

    const session: Session = {
      thinkrailSid,
      name: data.name ?? thinkrailSid.slice(0, 8),
      skillId: (data.skillId as string) ?? null,
      specIds: data.specIds ?? [],
      filePaths: (data.filePaths as string[]) ?? [],
      // If the backend runner is alive, use the actual status; otherwise
      // force "done" since there's nothing driving the session.
      status: isActive
        ? ((backendEntry?.status as SessionStatus) ?? SessionStatus.Idle)
        : SessionStatus.Done,
      model: restoredModel,
      permissionMode: (data.config?.permissionMode as string) ?? "default",
      effort: (data.config?.effort as string) ?? "auto",
      flags: (data.config?.flags as Record<string, boolean>) ?? {},
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
      pendingRequests: [],
      answeredRequests: answered,
      restored: !isActive,
      ticketId: (data.ticketId as string | null | undefined) ?? null,
      subagentMode: (data as unknown as Record<string, unknown>).subagentMode as Session["subagentMode"] ?? undefined,
      stepGate: (data as unknown as Record<string, unknown>).stepGate as Session["stepGate"] ?? undefined,
      ...(restoredPrompt ? { systemPrompt: restoredPrompt } : {}),
      parentThinkrailSid: (data as unknown as Record<string, unknown>).parentThinkrailSid as string ?? null,
      subsessionType: (data as unknown as Record<string, unknown>).subsessionType as Session["subsessionType"] ?? null,
      subsessionContext: (data as unknown as Record<string, unknown>).subsessionContext as string ?? null,
      subsessionOrigin: (data as unknown as Record<string, unknown>).subsessionOrigin as Session["subsessionOrigin"] ?? null,
      returnStatus: (data as unknown as Record<string, unknown>).returnStatus as Session["returnStatus"] ?? null,
      returnSummary: (data as unknown as Record<string, unknown>).returnSummary as string ?? null,
      outcome: ((data as unknown as Record<string, unknown>).outcome as Session["outcome"]) ?? null,
      artifacts: dedupArtifacts(
        ((data as unknown as Record<string, unknown>).artifacts as SessionArtifact[]) ?? [],
      ),
      previewPath:
        ((data as unknown as Record<string, unknown>).previewPath as string | null) ?? null,
      previewSection: null,
    };

    // Draft entries carry the in-progress prompt as `draftInput` — repopulate
    // the input box and label the tab from it.
    const draftInput = backendEntry?.draftInput;
    if (backendEntry?.status === SessionStatus.Draft) {
      if (draftInput) useInputDraftStore.getState().setDraft(thinkrailSid, draftInput);
      const resolved = resolveDraftName(data.name, draftInput ?? "");
      session.name = resolved.name;
      if (resolved.nameManuallySet) session.nameManuallySet = true;
    }

    set((s) => {
      const next = new Map(s.sessions);
      next.set(thinkrailSid, session);
      const nextClosed = new Set(s.closedIds);
      nextClosed.delete(thinkrailSid);
      // Ticket-attached sessions never become free-standing tabs unless the
      // caller explicitly opts in.
      if (noTab || (session.ticketId && !allowTicketTab)) {
        return { sessions: next, closedIds: nextClosed };
      }
      const tabs = new Set(s.openTabs);
      tabs.add(thinkrailSid);
      return { sessions: next, openTabs: tabs, activeSessionId: thinkrailSid, closedIds: nextClosed };
    });
    if (allowTicketTab && !noTab) useBoardStore.setState({ activeTicketId: null });
    } finally {
      _restoring.delete(thinkrailSid);
    }
  },

  unload: () => {
    _saving.clear();
    set({
      sessions: new Map(),
      activeSessionId: null,
      archivedSessions: [],
      closedIds: new Set(),
      deletedIds: new Set(),
      openTabs: new Set(),
      sessionList: [],
    });
  },

  loadActiveSessions: async ({ includeRecentDiskSession = false } = {}) => {
    const { createSessionApi } = await import("@/api/methods/sessions.ts");
    const api = createSessionApi(getClient());
    const all = await api.list();

    // Filter to active sessions not already in memory
    const currentSessions = get().sessions;
    const toLoad = all.filter((e) => e.active && !currentSessions.has(e.thinkrailSid));

    // Backend-restart recovery: if no live runners but the project has
    // produced a deliverable (state=initialized), load the most recent
    // session from disk so the user sees the conversation history.
    // Backend sorts list_sessions by mtime descending, so the first
    // entry is the freshest.
    if (includeRecentDiskSession && toLoad.length === 0) {
      const recent = all.find((e) => !currentSessions.has(e.thinkrailSid));
      if (recent) toLoad.push(recent);
    }

    // Fetch full data (with events) for each session in parallel
    const results = await Promise.allSettled(
      toLoad.map(async (entry) => {
        const data = await api.get(entry.thinkrailSid);
        return { entry, data };
      }),
    );

    set((s) => {
      const next = new Map(s.sessions);
      for (const result of results) {
        if (result.status === "rejected") continue;
        const { entry, data } = result.value;
        if (next.has(entry.thinkrailSid)) continue;

        // Convert backend events to AgentEvent format
        const events: AgentEvent[] = (data?.events ?? []).map((ev: Record<string, unknown>) => ({
          thinkrailSid: entry.thinkrailSid,
          sessionId: ((ev.payload as Record<string, unknown>)?.sessionId as string) ?? "",
          eventType: ((ev.eventType as string) ?? "notification") as AgentEvent["eventType"],
          payload: (ev.payload as Record<string, unknown>) ?? ev,
        } as unknown as AgentEvent));

        const restoredCost = reconstructCost(events);
        const entryModel = (data?.config?.model as string) ?? entry.model ?? "";
        const diskMetrics = (data?.metrics ?? {}) as Record<string, unknown>;
        const restoredCtx = reconstructContextUsage(events, (diskMetrics.contextMax as number) ?? 0);

        // Restore system prompt: from entry (drafts) or from sessionStart event payload
        const restoredPrompt = entry.systemPrompt as string | undefined
          ?? (events.find((e) => e.eventType === EventType.SessionStart)?.payload.systemPrompt as string | undefined);

        const draftName = entry.status === SessionStatus.Draft
          ? resolveDraftName(data?.name ?? entry.name, entry.draftInput ?? "")
          : null;

        next.set(entry.thinkrailSid, {
          thinkrailSid: entry.thinkrailSid,
          name: draftName
            ? draftName.name
            : (data?.name ?? entry.name ?? entry.thinkrailSid.slice(0, 8)),
          ...(draftName?.nameManuallySet ? { nameManuallySet: true } : {}),
          skillId: (data?.skillId as string) ?? entry.skillId ?? null,
          specIds: data?.specIds ?? entry.specIds ?? [],
          filePaths: (data?.filePaths as string[]) ?? [],
          status: entry.active && !entry.inTracker ? SessionStatus.Done : ((entry.status as SessionStatus) ?? SessionStatus.Idle),
          model: entryModel,
          permissionMode: (data?.config?.permissionMode as string) ?? "default",
          effort: (data?.config?.effort as string) ?? "auto",
          flags: (data?.config?.flags as Record<string, boolean>) ?? {},
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
          pendingRequests: [],
          answeredRequests: buildAnsweredRequests(events, true),
          // Disk-only sessions have no live runner — surface the
          // RestoredBar with its "Resume" button (which calls
          // session/continue) instead of the regular input area.
          restored: !entry.inTracker,
          ...(restoredPrompt ? { systemPrompt: restoredPrompt } : {}),
          parentThinkrailSid: (data as unknown as Record<string, unknown>)?.parentThinkrailSid as string ?? null,
          subsessionType: (data as unknown as Record<string, unknown>)?.subsessionType as Session["subsessionType"] ?? null,
          subsessionContext: (data as unknown as Record<string, unknown>)?.subsessionContext as string ?? null,
          subsessionOrigin: (data as unknown as Record<string, unknown>)?.subsessionOrigin as Session["subsessionOrigin"] ?? null,
          returnStatus: (data as unknown as Record<string, unknown>)?.returnStatus as Session["returnStatus"] ?? null,
          returnSummary: (data as unknown as Record<string, unknown>)?.returnSummary as string ?? null,
          outcome: ((data as unknown as Record<string, unknown>)?.outcome
            ?? (entry as unknown as Record<string, unknown>)?.outcome
            ?? null) as Session["outcome"],
          artifacts: dedupArtifacts(
            ((data as unknown as Record<string, unknown>)?.artifacts as SessionArtifact[]) ?? [],
          ),
          previewPath:
            ((data as unknown as Record<string, unknown>)?.previewPath as string | null) ?? null,
          previewSection: null,
          subagentMode:
            ((data as unknown as Record<string, unknown>)?.subagentMode as Session["subagentMode"])
            ?? ((entry as unknown as Record<string, unknown>)?.subagentMode as Session["subagentMode"])
            ?? undefined,
          stepGate:
            ((data as unknown as Record<string, unknown>)?.stepGate as Session["stepGate"])
            ?? ((entry as unknown as Record<string, unknown>)?.stepGate as Session["stepGate"])
            ?? undefined,
          ticketId:
            ((data as unknown as Record<string, unknown>)?.ticketId as string | null | undefined)
            ?? ((entry as unknown as Record<string, unknown>)?.ticketId as string | null | undefined)
            ?? null,
        });
      }

      // Auto-activate the most relevant session if none is active yet.
      // Priority:
      //   1. Already-active in store (no-op after first load).
      //   2. Remembered last-active for this project (page-reload recall).
      //   3. Running session.
      //   4. Most recently started active session.
      //   5. Most recently updated disk session (only when caller opts in).
      let autoActiveId: string | null = s.activeSessionId;
      if (!autoActiveId) {
        const projectPath = useUiStore.getState().projectPath;
        const remembered = projectPath
          ? useUiStore.getState().lastActiveSessions[projectPath]
          : undefined;
        // Only accept the remembered ID if the session still exists in the
        // list — otherwise it's stale (session deleted or moved).
        if (remembered && all.some((e) => e.thinkrailSid === remembered)) {
          autoActiveId = remembered;
        }
      }
      if (!autoActiveId) {
        const activeCandidates = all.filter((e) => e.active);
        const best = activeCandidates.find((e) => e.status === SessionStatus.Running)
          ?? activeCandidates.sort(
            (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
          )[0];
        autoActiveId = best?.thinkrailSid ?? null;
        if (!autoActiveId && includeRecentDiskSession) {
          const loaded = results.find((r) => r.status === "fulfilled");
          if (loaded?.status === "fulfilled") {
            autoActiveId = loaded.value.entry.thinkrailSid;
          }
        }
      }

      // Open tabs for all loaded sessions (they had tabs before the refresh)
      const tabs = new Set(s.openTabs);
      for (const result of results) {
        if (result.status === "fulfilled") {
          tabs.add(result.value.entry.thinkrailSid);
        }
      }

      return {
        sessions: next,
        openTabs: tabs,
        activeSessionId: autoActiveId,
      };
    });

    // Repopulate the input box for restored drafts from their `draftInput`.
    for (const result of results) {
      if (result.status !== "fulfilled") continue;
      const { entry } = result.value;
      if (entry.status === SessionStatus.Draft && entry.draftInput) {
        useInputDraftStore.getState().setDraft(entry.thinkrailSid, entry.draftInput);
      }
    }
  },

  syncSessionStatuses: async () => {
    const sessions = get().sessions;
    // Collect sessions in transient states that need checking
    const toCheck: string[] = [];
    for (const [sid, session] of sessions) {
      if (isTransient(session.status)) {
        toCheck.push(sid);
      }
    }
    if (toCheck.length === 0) return;

    const api = createAgentApi(getClient());
    await Promise.allSettled(
      toCheck.map(async (thinkrailSid) => {
        try {
          const task = await api.status(thinkrailSid);
          const backendStatus = task.status; // "initializing" | "idle" | "running" | "waiting" | "done" | "error"
          const session = get().sessions.get(thinkrailSid);
          if (!session) return;

          // Map backend TaskStatus to frontend SessionStatus
          // Backend "idle" means the turn finished → frontend should be "idle"
          // Backend "done" → frontend "done"
          // Backend "error" → frontend "error"
          // Backend "running" → keep current frontend status (still in progress)
          if (backendStatus === SessionStatus.Running) return; // still running, no update needed

          if (session.status !== backendStatus) {
            console.log(`[syncSessionStatuses] ${thinkrailSid}: ${session.status} → ${backendStatus}`);
            set((s) => {
              const current = s.sessions.get(thinkrailSid);
              if (!current) return s;
              // Don't overwrite if status already changed (e.g., event arrived)
              if (!isTransient(current.status)) return s;
              const next = new Map(s.sessions);
              next.set(thinkrailSid, {
                ...current,
                status: backendStatus as SessionStatus,
                pendingRequests: backendStatus === SessionStatus.Idle || backendStatus === SessionStatus.Done ? [] : current.pendingRequests,
              });
              return { sessions: next };
            });
          }
        } catch (err: unknown) {
          // Distinguish JSON-RPC errors (task genuinely not found) from
          // network/timeout errors (transient — leave status unchanged).
          const isRpcError = err && typeof err === "object" && "code" in err;
          if (isRpcError) {
            const session = get().sessions.get(thinkrailSid);
            if (!session) return;
            // Grace period: don't mark as done if session entered initializing < 10s ago
            // to avoid racing with continueSession (backend task not yet created).
            const isRecent = session.status === SessionStatus.Initializing && (Date.now() - session.startedAt) < 10_000;
            if (!isRecent && isTransient(session.status)) {
              console.log(`[syncSessionStatuses] ${thinkrailSid}: task not found, marking done`);
              set((s) => {
                const current = s.sessions.get(thinkrailSid);
                if (!current) return s;
                if (!isTransient(current.status)) return s;
                const next = new Map(s.sessions);
                next.set(thinkrailSid, { ...current, status: SessionStatus.Done, pendingRequests: [] });
                return { sessions: next };
              });
            }
          } else {
            // Network error — leave status unchanged, will retry on next poll
            console.warn(`[syncSessionStatuses] ${thinkrailSid}: network error, skipping`, err);
          }
        }
      }),
    );
  },

  closeSession: (thinkrailSid) => {
    // Close the tab. Live sessions stay in the store (background). No END_SIGNAL.
    set((s) => {
      const session = s.sessions.get(thinkrailSid);
      if (!session) return s;

      const tabs = new Set(s.openTabs);
      tabs.delete(thinkrailSid);

      // Pick next active from remaining open tabs
      const nextActive =
        s.activeSessionId === thinkrailSid
          ? (Array.from(tabs).find((id) => s.sessions.has(id)) ?? null)
          : s.activeSessionId;

      // Terminal sessions: remove from store and archive
      if (isTerminal(session.status)) {
        const next = new Map(s.sessions);
        next.delete(thinkrailSid);
        const nextClosed = new Set(s.closedIds);
        nextClosed.add(thinkrailSid);
        return {
          sessions: next,
          openTabs: tabs,
          activeSessionId: nextActive,
          closedIds: nextClosed,
          archivedSessions: [
            ...s.archivedSessions,
            {
              thinkrailSid: session.thinkrailSid, name: session.name,
              skillId: session.skillId, specIds: session.specIds,
              startedAt: session.startedAt, endedAt: Date.now(),
              result: session.status === SessionStatus.Done ? SessionStatus.Done : SessionStatus.Error,
              costUsd: session.metrics.costUsd, turns: session.metrics.turns,
              durationMs: session.metrics.durationMs, model: session.model,
              config: { model: session.model, permissionMode: session.permissionMode, streamText: true, effort: session.effort ?? "auto", flags: session.flags ?? {} },
              events: session.events,
            },
          ],
        };
      }

      // Live sessions: just remove from openTabs, stay in sessions map
      return { openTabs: tabs, activeSessionId: nextActive };
    });
  },

  deleteSession: async (thinkrailSid) => {
    // Cancel any armed autosave so a trailing timer can't re-persist after delete.
    draftAutosave.cancel(thinkrailSid);
    const session = get().sessions.get(thinkrailSid);
    const inFlightSave = _saving.get(thinkrailSid);

    const dropLocally = () => {
      useInputDraftStore.getState().clearDraft(thinkrailSid);
      // Close tab (handles activeSessionId switching)
      get().closeSession(thinkrailSid);
      // Remove from sessions map and ignore late-arriving events
      set((s) => {
        const sessions = new Map(s.sessions);
        sessions.delete(thinkrailSid);
        const closedIds = new Set(s.closedIds);
        closedIds.add(thinkrailSid);
        const deletedIds = new Set(s.deletedIds);
        deletedIds.add(thinkrailSid);
        const sessionList = s.sessionList.filter((e) => e.thinkrailSid !== thinkrailSid);
        return { sessions, closedIds, deletedIds, sessionList };
      });
    };

    // An unsaved draft with no save in flight has no backend task or file —
    // discard it purely locally, no RPC.
    if (session?.unsaved && !inFlightSave) {
      dropLocally();
      return;
    }

    // A first save may be mid-flight; let it finish so the file exists to
    // delete, otherwise its prepare lands after the delete and orphans a file.
    if (inFlightSave) {
      try { await inFlightSave; } catch { /* save failed: nothing persisted */ }
    }

    const { createSessionApi } = await import("@/api/methods/sessions.ts");
    const api = createSessionApi(getClient());
    await api.delete(thinkrailSid);
    dropLocally();
  },

  removeSessionsForTicket: (ticketId) => {
    const ids = new Set<string>();
    for (const [sid, sess] of get().sessions) {
      if (sess.ticketId === ticketId) ids.add(sid);
    }
    for (const e of get().sessionList) {
      if (e.ticketId === ticketId) ids.add(e.thinkrailSid);
    }
    if (ids.size === 0) return;

    for (const sid of ids) {
      // Stop any armed autosave so a trailing timer can't re-persist a session
      // whose ticket is gone.
      draftAutosave.cancel(sid);
      useInputDraftStore.getState().clearDraft(sid);
    }

    set((s) => {
      const sessions = new Map(s.sessions);
      const openTabs = new Set(s.openTabs);
      const closedIds = new Set(s.closedIds);
      const deletedIds = new Set(s.deletedIds);
      for (const sid of ids) {
        sessions.delete(sid);
        openTabs.delete(sid);
        closedIds.add(sid);
        deletedIds.add(sid);
      }
      const sessionList = s.sessionList.filter((e) => !ids.has(e.thinkrailSid));
      const activeSessionId =
        s.activeSessionId && ids.has(s.activeSessionId) ? null : s.activeSessionId;
      return { sessions, openTabs, closedIds, deletedIds, sessionList, activeSessionId };
    });
  },

  endSession: async (thinkrailSid) => {
    const api = createAgentApi(getClient());
    await api.end(thinkrailSid);
  },

  openTab: (thinkrailSid, opts) => {
    const session = get().sessions.get(thinkrailSid);
    if (!session) return;
    // Ticket-attached sessions reroute to the ticket view by default, unless
    // the caller explicitly wants a free-standing session tab.
    if (session.ticketId && !opts?.allowTicketTab) {
      useUiStore.getState().setCenterView("board");
      useBoardStore.getState().openTicket(session.ticketId);
      return;
    }
    useBoardStore.setState({ activeTicketId: null });
    set((s) => {
      const tabs = new Set(s.openTabs);
      tabs.add(thinkrailSid);
      return { openTabs: tabs, activeSessionId: thinkrailSid };
    });
  },

  focusSession: (thinkrailSid, opts) => {
    const session = get().sessions.get(thinkrailSid);
    if (!session) return;

    useFileStore.setState({ activeFilePath: null, previewFilePath: null, previewFile: null });

    // Ticket-attached: reroute to the ticket view unless the caller wants a
    // free-standing session tab (explicit user open).
    if (session.ticketId && !opts?.allowTicketTab) {
      useUiStore.getState().setCenterView("board");
      useBoardStore.getState().openTicket(session.ticketId);
      return;
    }

    useBoardStore.setState({ activeTicketId: null });
    set((s) => {
      const tabs = new Set(s.openTabs);
      tabs.add(thinkrailSid);
      return { openTabs: tabs, activeSessionId: thinkrailSid };
    });
  },

  getStaleSessionRefs: (thinkrailSid) => {
    const session = get().sessions.get(thinkrailSid);
    if (!session) return null;

    const specs = useSpecStore.getState().specs;
    const staleSpecIds = findStaleSpecIds(session.specIds, specs);
    const skills = useSettingsStore.getState().skills;
    const staleSkillId = !isSkillValid(session.skillId, skills);

    if (staleSpecIds.length === 0 && !staleSkillId) return null;
    return { staleSpecIds, staleSkillId };
  },

  fixStaleSessionRefs: async (thinkrailSid) => {
    const session = get().sessions.get(thinkrailSid);
    if (!session) return;

    const stale = get().getStaleSessionRefs(thinkrailSid);
    if (!stale) return;

    const changes: { specIds?: string[]; filePaths?: string[]; skillId?: string | null; config?: AgentConfig; prompt?: string | null; name?: string; ticketId?: string | null } = {};
    if (stale.staleSpecIds.length > 0) {
      changes.specIds = session.specIds.filter((id) => !stale.staleSpecIds.includes(id));
    }
    if (stale.staleSkillId) {
      changes.skillId = null;
    }

    if (session.status === SessionStatus.Draft) {
      await get().updateDraft(thinkrailSid, changes);
    } else {
      // For non-draft sessions, update locally only (display fix)
      const sessions = new Map(get().sessions);
      const updated = { ...session };
      if (changes.specIds) updated.specIds = changes.specIds;
      if (changes.skillId === null) updated.skillId = null;
      sessions.set(thinkrailSid, updated);
      set({ sessions });
    }
  },

  interruptSession: async (thinkrailSid) => {
    try {
      const api = createAgentApi(getClient());
      await api.interrupt(thinkrailSid);
      // Status transition is handled by the agent/interrupted notification
    } catch (err) {
      console.warn("[interruptSession] failed:", err);
    }
  },

  resolveRequest: (thinkrailSid, requestId, response) => {
    // Send the response to the backend via agent/respond RPC method.
    // This resolves the asyncio.Future in the backend tracker.
    const api = createAgentApi(getClient());
    api.respond(thinkrailSid, requestId, response).catch((err) => {
      console.error("Failed to send agent/respond:", err);
    });

    // Refinement subsession: when user picks a version (not "Adjust"),
    // automatically trigger return flow to propagate text to parent.
    const session = get().sessions.get(thinkrailSid);
    if (session?.subsessionType === "refinement" && session?.parentThinkrailSid) {
      const r = response as { questions?: { options?: { label: string; description: string }[] }[]; answers?: Record<string, string> };
      if (r.answers && r.questions) {
        const firstAnswer = Object.values(r.answers)[0];
        if (firstAnswer && !firstAnswer.toLowerCase().includes("adjust")) {
          // Find the selected option's description (contains the full message text)
          const question = r.questions[0];
          const selectedOption = question?.options?.find((o: { label: string }) => o.label === firstAnswer);
          if (selectedOption?.description) {
            get().approveReturn(thinkrailSid, selectedOption.description);
          }
        }
      }
    }

    // Mark request as answered, drop it from pendingRequests, and restore
    // running status (unless other pending entries keep the session waiting).
    // The backend stays in "running" throughout the turn — only the frontend
    // shows "waiting" while the user answers. Setting "running" here is correct
    // state sync (not optimism), since the backend never left "running".
    set((s) => {
      const session = s.sessions.get(thinkrailSid);
      if (!session) return s;
      const nextSessions = new Map(s.sessions);
      const answered = new Map(session.answeredRequests);
      answered.set(requestId, response);
      nextSessions.set(thinkrailSid, {
        ...session,
        status: SessionStatus.Running,
        pendingRequests: session.pendingRequests.filter(
          (r) => r.requestId !== requestId,
        ),
        answeredRequests: answered,
      });
      return { sessions: nextSessions };
    });

    // Dismiss related toasts, decrement counter, and clear tab badge
    const ns = useNotificationStore.getState();
    ns.decrementPendingInput();
    for (const t of ns.toasts) {
      if (t.thinkrailSid === thinkrailSid && (t.eventType === "question" || t.eventType === "approval" || t.eventType === "suggestion")) {
        ns.dismissToast(t.id);
      }
    }
    ns.clearBadge(thinkrailSid);
  },

  updateConfig: async (thinkrailSid, config) => {
    const api = createAgentApi(getClient());
    await api.updateConfig(thinkrailSid, config);
  },

  restartSession: async (thinkrailSid) => {
    const { createSessionApi } = await import("@/api/methods/sessions.ts");
    const api = createSessionApi(getClient());
    await api.restart(thinkrailSid);
    // Backend creates a new session starting in initializing
    set((s) => {
      const session = s.sessions.get(thinkrailSid);
      if (!session) return s;
      const next = new Map(s.sessions);
      const cu = session.metrics.contextUsage;
      next.set(thinkrailSid, {
        ...session,
        status: SessionStatus.Initializing,
        pendingRequests: [],
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
    const thinkrailSid = params.thinkrailSid as string;
    set((s) => {
      const session = s.sessions.get(thinkrailSid);
      if (!session) return s;
      const newModel = (params.model as string) ?? session.model;
      // The runtime re-reports the window on the next turn after a model
      // switch; carry the current denominator forward until then.
      const contextMax = (params.contextMax as number) || session.metrics.contextMax || 0;
      const next = new Map(s.sessions);
      next.set(thinkrailSid, {
        ...session,
        model: newModel,
        permissionMode: (params.permissionMode as string) ?? session.permissionMode,
        effort: (params.effort as string) ?? session.effort,
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
    const thinkrailSid = params.thinkrailSid as string;
    set((s) => {
      const withSession = ensureSession(s.sessions, thinkrailSid, s.closedIds);
      const session = withSession.get(thinkrailSid);
      if (!session) return s;
      const next = new Map(withSession);
      const cu = session.metrics.contextUsage;
      next.set(thinkrailSid, {
        ...session,
        status: isQuiescent(session.status) ? SessionStatus.Running : session.status,
        model: (params.model as string) ?? session.model,
        systemPrompt: (params.systemPrompt as string) ?? undefined,
        events: [
          ...session.events,
          {
            thinkrailSid,
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

  onSessionMetadataUpdate: (task) => {
    const thinkrailSid = task.thinkrailSid as string | undefined;
    if (!thinkrailSid) return;
    set((s) => {
      const existing = s.sessions.get(thinkrailSid);
      if (!existing) return s;
      const outcome = (task.outcome as Session["outcome"]) ?? null;
      const next = new Map(s.sessions);
      next.set(thinkrailSid, { ...existing, outcome });
      return { sessions: next };
    });
  },

  patchOutcomeAction: async (thinkrailSid, actionId, patch) => {
    // Optimistic update for instant feedback
    set((s) => {
      const existing = s.sessions.get(thinkrailSid);
      if (!existing?.outcome) return s;
      const nextActions = existing.outcome.actions.map((a) =>
        a.id === actionId ? ({ ...a, ...patch } as typeof a) : a,
      );
      const next = new Map(s.sessions);
      next.set(thinkrailSid, {
        ...existing,
        outcome: { ...existing.outcome, actions: nextActions },
      });
      return { sessions: next };
    });
    try {
      await getClient().request("session/patchOutcomeAction", {
        thinkrailSid,
        actionId,
        patch,
      });
    } catch (e) {
      console.error("[sessionStore] patchOutcomeAction failed:", e);
    }
  },

  onAgentEvent: (method, params) => {
    const thinkrailSid = params.thinkrailSid as string;
    // Capture before set() — applyMetrics clears pendingRequests inside the setter.
    const hadPending = (get().sessions.get(thinkrailSid)?.pendingRequests.length ?? 0) > 0;
    set((s) => {
      const sessions = appendEvent(s.sessions, thinkrailSid, method, params, s.closedIds);
      let session = sessions.get(thinkrailSid);
      if (session) {
        // Belt-and-suspenders: if we receive work events while idle, transition
        // to running.  Catches the case where agent/statusChanged was missed
        // (e.g. during a WebSocket reconnect).
        if (session.status === SessionStatus.Idle) {
          if (_RUNNING_SIGNALS.has(method)) {
            const updated = { ...session, status: SessionStatus.Running };
            sessions.set(thinkrailSid, updated);
            session = updated;
          }
        }

        if (method === "agent/ready") {
          if (session.status === SessionStatus.Initializing) {
            sessions.set(thinkrailSid, { ...session, status: SessionStatus.Idle });
          }
        } else if (method === "agent/costEstimate") {
          const est = params.estimatedCostUsd as number;
          const turnEst = params.estimatedTurnCostUsd as number;
          // Context bar / breakdown reflect the latest iteration (last API call).
          const contextTokens = (params.currentContextWindow as number) ?? 0;
          const iterInput = (params.iterInputTokens as number) ?? 0;
          const iterCacheRead = (params.iterCacheRead as number) ?? 0;
          const iterCacheCreate = (params.iterCacheCreate as number) ?? 0;
          const iterOutput = (params.iterOutputTokens as number) ?? 0;
          // Turn-history row shows cumulative turn totals so input/output grow
          // monotonically with the cost (the latest iteration resets to 0 at the
          // start of each tool-use loop).
          const turnInput = (params.turnInputTokens as number) ?? 0;
          const turnOutput = (params.turnOutputTokens as number) ?? 0;
          const turnCacheRead = (params.turnCacheRead as number) ?? 0;
          const turnCacheWrite = (params.turnCacheWrite as number) ?? 0;
          // costEstimate never carries the window; keep the current denominator.
          const contextMax = session.metrics.contextMax || 0;

          const prevUsage = session.metrics.contextUsage;
          const liveTurn: TurnUsage = {
            turnIndex: prevUsage.turnHistory.length,
            inputTokens: turnInput,
            outputTokens: turnOutput,
            cacheCreationTokens: turnCacheWrite,
            cacheReadTokens: turnCacheRead,
            totalContextTokens: contextTokens,
            costUsd: typeof turnEst === "number" ? turnEst : 0,
            timestamp: prevUsage.liveTurn?.timestamp ?? Date.now(),
            sdkTurns: 0,
          };

          const next = new Map(sessions);
          next.set(thinkrailSid, {
            ...session,
            metrics: {
              ...session.metrics,
              costUsd: typeof est === "number" ? est : session.metrics.costUsd,
              contextTokens,
              contextMax,
              contextUsage: {
                ...prevUsage,
                contextMax,
                contextTokens,
                inputTokens: iterInput,
                cacheReadTokens: iterCacheRead,
                cacheCreationTokens: iterCacheCreate,
                outputTokens: iterOutput,
                liveTurn,
              },
            },
          });
          return { sessions: next };
        } else if (method === "agent/turnComplete" || method === "agent/interrupted") {
          const updated = applyMetrics(session, params, SessionStatus.Idle);

          if (method === "agent/interrupted" && session.pendingRequests.length > 0) {
            // Only mark each as denied if user has NOT already answered.
            // Race: user clicks Approve (resolveRequest sets answeredRequests),
            // then agent/interrupted arrives — don't clobber the user's answer.
            let answered = updated.answeredRequests;
            for (const req of session.pendingRequests) {
              if (!answered.has(req.requestId)) {
                answered = new Map(answered);
                answered.set(req.requestId, {
                  behavior: "deny",
                  message: "Interrupted",
                  interrupt: true,
                });
              }
            }
            updated.answeredRequests = answered;
          }

          sessions.set(thinkrailSid, updated);
        } else if (method === "agent/statusChanged") {
          const newStatus = params.status as SessionStatus;
          // Apply backend status unless frontend is in a frontend-only state
          // ("waiting" is set locally by onAskQuestion/onConfirmAction) or a
          // terminal state that should only change via onSessionDone/onSessionError.
          if (
            session.status !== newStatus &&
            session.status !== SessionStatus.Waiting &&
            !isTerminal(session.status)
          ) {
            sessions.set(thinkrailSid, { ...session, status: newStatus });
          }
        }
      }
      return { sessions };
    });

    // Clean up notifications when interrupted during a pending request.
    // Only decrement if there was actually a pending request — otherwise
    // the counter goes negative.  hadPending is captured before set() above
    // because applyMetrics clears pendingRequests inside the setter.
    if (method === "agent/interrupted") {
      if (hadPending) {
        const ns = useNotificationStore.getState();
        ns.decrementPendingInput();
        for (const t of ns.toasts) {
          if (
            t.thinkrailSid === thinkrailSid &&
            (t.eventType === "question" || t.eventType === "approval" || t.eventType === "suggestion")
          ) {
            ns.dismissToast(t.id);
          }
        }
        ns.clearBadge(thinkrailSid);
      }
    }
  },

  onAskQuestion: (params) => {
    const thinkrailSid = params.thinkrailSid as string;
    const requestId = params.requestId as string;
    set((s) => {
      const session = s.sessions.get(thinkrailSid);
      // Retry dedup: same requestId already in flight → drop the duplicate event.
      if (session?.pendingRequests.some((r) => r.requestId === requestId)) {
        return s;
      }
      const sessions = appendEvent(
        s.sessions,
        thinkrailSid,
        "agent/askUserQuestion",
        params,
        s.closedIds,
      );
      const updated = sessions.get(thinkrailSid);
      if (updated) {
        sessions.set(thinkrailSid, {
          ...updated,
          status: SessionStatus.Waiting,
          pendingRequests: [...updated.pendingRequests, {
            requestId,
            type: "question",
            questions: params.questions as PendingRequest["questions"],
          }],
        });
      }
      return { sessions };
    });
  },

  onConfirmAction: (params) => {
    const thinkrailSid = params.thinkrailSid as string;
    const requestId = params.requestId as string;
    set((s) => {
      const session = s.sessions.get(thinkrailSid);
      if (session?.pendingRequests.some((r) => r.requestId === requestId)) {
        return s;
      }
      const sessions = appendEvent(
        s.sessions,
        thinkrailSid,
        "agent/confirmAction",
        params,
        s.closedIds,
      );
      const updated = sessions.get(thinkrailSid);
      if (updated) {
        sessions.set(thinkrailSid, {
          ...updated,
          status: SessionStatus.Waiting,
          pendingRequests: [...updated.pendingRequests, {
            requestId,
            type: "approval",
            toolName: params.toolName as string,
            toolInput: params.toolInput as Record<string, unknown>,
          }],
        });
      }
      return { sessions };
    });
  },

  onSuggestSession: (params) => {
    const thinkrailSid = params.thinkrailSid as string;
    const requestId = params.requestId as string;
    set((s) => {
      const sessions = appendEvent(
        s.sessions,
        thinkrailSid,
        "agent/suggestSession",
        params,
        s.closedIds,
      );
      const session = sessions.get(thinkrailSid);
      if (session) {
        sessions.set(thinkrailSid, {
          ...session,
          status: SessionStatus.Waiting,
          pendingRequests: [...session.pendingRequests, {
            requestId,
            type: "suggestion",
            skill: params.skill as string,
            specIds: (params.specIds as string[]) ?? [],
            name: params.name as string,
            reason: params.reason as string,
            prompt: (params.prompt as string) ?? undefined,
          }],
        });
      }
      return { sessions };
    });
  },

  onSuggestDescription: (params) => {
    const thinkrailSid = params.thinkrailSid as string;
    const requestId = params.requestId as string;
    set((s) => {
      const sessions = appendEvent(
        s.sessions,
        thinkrailSid,
        "agent/suggestDescription",
        params,
        s.closedIds,
      );
      const session = sessions.get(thinkrailSid);
      if (session) {
        sessions.set(thinkrailSid, {
          ...session,
          status: SessionStatus.Waiting,
          pendingRequests: [...session.pendingRequests, {
            requestId,
            type: "description-suggestion",
            description: params.description as string,
            section: (params.section as string) ?? "full",
          }],
        });
      }
      return { sessions };
    });
  },

  onSuggestStep: (params) => {
    const thinkrailSid = params.thinkrailSid as string;
    const requestId = params.requestId as string;
    set((s) => {
      const sessions = appendEvent(
        s.sessions,
        thinkrailSid,
        "agent/suggestStep",
        params,
        s.closedIds,
      );
      const session = sessions.get(thinkrailSid);
      if (session) {
        sessions.set(thinkrailSid, {
          ...session,
          status: SessionStatus.Waiting,
          pendingRequests: [...session.pendingRequests, {
            requestId,
            type: "step-proposal",
            ticketId: params.ticketId as string,
            stepNumber: params.stepNumber as number,
            stepTitle: params.stepTitle as string,
            skill: params.skill as string,
            inputSpecIds: (params.inputSpecIds as string[]) ?? [],
            reason: params.reason as string,
          }],
        });
      }
      return { sessions };
    });
  },

  onSetPreviewFile: (params) => {
    const thinkrailSid = params.thinkrailSid as string;
    const path = (params.path as string | null) ?? null;
    const section = (params.section as string | undefined) ?? null;
    set((s) => {
      const session = s.sessions.get(thinkrailSid);
      if (!session) return s;
      const sessions = new Map(s.sessions);
      sessions.set(thinkrailSid, {
        ...session,
        previewPath: path,
        previewSection: path != null ? section : null,
      });
      return { sessions };
    });
  },

  onClearPreviewFile: (params) => {
    // Deprecated alias. Path-null SetPreviewFile is canonical; this stays
    // for backwards-compat with old persisted events.
    const thinkrailSid = params.thinkrailSid as string;
    set((s) => {
      const session = s.sessions.get(thinkrailSid);
      if (!session) return s;
      const sessions = new Map(s.sessions);
      sessions.set(thinkrailSid, {
        ...session,
        previewPath: null,
        previewSection: null,
      });
      return { sessions };
    });
  },

  onArtifactAdded: (params) => {
    const thinkrailSid = params.thinkrailSid as string;
    const artifact = params.artifact as SessionArtifact;
    set((s) => {
      const session = s.sessions.get(thinkrailSid);
      if (!session) return s;
      const sessions = new Map(s.sessions);
      // Match same logical file even when one side is absolute / the other
      // relative (legacy entries from before path normalization).
      const existingIdx = session.artifacts.findIndex(
        (a) => _sameArtifactFile(a.path, artifact.path),
      );
      const nextArtifacts =
        existingIdx >= 0
          ? session.artifacts.map((a, i) =>
              i === existingIdx ? { ...a, ...artifact } : a,
            )
          : [...session.artifacts, artifact];
      sessions.set(thinkrailSid, { ...session, artifacts: nextArtifacts });
      return { sessions };
    });
  },

  onArtifactLabeled: (params) => {
    const thinkrailSid = params.thinkrailSid as string;
    const path = params.path as string;
    const role = params.role as string | undefined;
    const label = params.label as string | undefined;
    set((s) => {
      const session = s.sessions.get(thinkrailSid);
      if (!session) return s;
      const sessions = new Map(s.sessions);
      const nextArtifacts = session.artifacts.map((a) =>
        a.path === path
          ? { ...a, role: role ?? a.role, label: label ?? a.label }
          : a,
      );
      sessions.set(thinkrailSid, { ...session, artifacts: nextArtifacts });
      return { sessions };
    });
  },

  setPreviewPath: (thinkrailSid, path) => {
    set((s) => {
      const session = s.sessions.get(thinkrailSid);
      if (!session) return s;
      const sessions = new Map(s.sessions);
      sessions.set(thinkrailSid, { ...session, previewPath: path });
      return { sessions };
    });
  },

  onRequestExpired: (params) => {
    const thinkrailSid = params.thinkrailSid as string;
    const requestId = params.requestId as string;
    set((s) => {
      const sessions = appendEvent(
        s.sessions,
        thinkrailSid,
        "agent/requestExpired",
        params,
        s.closedIds,
      );
      const session = sessions.get(thinkrailSid);
      if (session) {
        // Drop the expired request from the list (no-op if it was already gone)
        // and mark as expired in answeredRequests so the renderer shows the
        // terminal state.
        const answered = new Map(session.answeredRequests);
        answered.set(requestId, { expired: true, reason: params.reason });
        sessions.set(thinkrailSid, {
          ...session,
          pendingRequests: session.pendingRequests.filter(
            (r) => r.requestId !== requestId,
          ),
          answeredRequests: answered,
        });
      }
      return { sessions };
    });
  },

  onRequestResolved: (params) => {
    const thinkrailSid = params.thinkrailSid as string;
    const requestId = params.requestId as string;
    // The backend forwards the original response object (with `behavior` field
    // for approvals, `answers` for questions) so the renderer can determine
    // the correct decision display.
    const response = (params.response as Record<string, unknown>) ?? {};
    set((s) => {
      const sessions = new Map(s.sessions);
      const session = sessions.get(thinkrailSid);
      if (session) {
        const hadMatching = session.pendingRequests.some(
          (r) => r.requestId === requestId,
        );
        const remaining = session.pendingRequests.filter(
          (r) => r.requestId !== requestId,
        );
        const answered = new Map(session.answeredRequests);
        answered.set(requestId, { ...response, resolvedBy: params.resolvedBy });
        sessions.set(thinkrailSid, {
          ...session,
          // When the resolved request was the only one outstanding, transition
          // back to running. With multiple pendings (subagent-mode parallel
          // approvals), the others keep the session in "waiting."
          status: hadMatching && remaining.length === 0 ? SessionStatus.Running : session.status,
          pendingRequests: remaining,
          answeredRequests: answered,
        });
      }
      return { sessions };
    });
    // Only decrement if we actually had this pending in flight before resolve.
    const session = get().sessions.get(thinkrailSid);
    const stillPending = session?.pendingRequests.some((r) => r.requestId === requestId);
    if (!stillPending) {
      useNotificationStore.getState().decrementPendingInput();
    }
  },

  onRemoteSessionCreated: (params) => {
    const thinkrailSid = params.thinkrailSid as string;
    set((s) => {
      // If session already exists (created locally), update metadata
      const existing = s.sessions.get(thinkrailSid);
      const next = new Map(s.sessions);
      const config = (params.config as Record<string, unknown>) ?? {};
      const subagentMode = (params.subagentMode as Session["subagentMode"]) ?? undefined;
      const stepGate = (params.stepGate as Session["stepGate"]) ?? undefined;
      const session: Session = existing
        ? {
            ...existing,
            name: (params.name as string) || existing.name,
            skillId: (params.skillId as string) ?? existing.skillId,
            specIds: (params.specIds as string[]) ?? existing.specIds,
            filePaths: (params.filePaths as string[]) ?? existing.filePaths,
            model: (config.model as string) || existing.model,
            permissionMode: (config.permissionMode as string) || existing.permissionMode,
            effort: (config.effort as string) ?? existing.effort,
            flags: (config.flags as Record<string, boolean>) ?? existing.flags ?? {},
            status: (params.status as Session["status"]) ?? existing.status,
            createdBy: (params.createdBy as string) ?? existing.createdBy,
            subagentMode: subagentMode ?? existing.subagentMode,
            stepGate: stepGate ?? existing.stepGate,
          }
        : {
            thinkrailSid,
            name: (params.name as string) || thinkrailSid.slice(0, 8),
            skillId: (params.skillId as string) ?? null,
            specIds: (params.specIds as string[]) ?? [],
            filePaths: (params.filePaths as string[]) ?? [],
            status: (params.status as Session["status"]) ?? SessionStatus.Draft,
            model: (config.model as string) || "",
            permissionMode: (config.permissionMode as string) || "default",
            effort: (config.effort as string) ?? "auto",
            flags: (config.flags as Record<string, boolean>) ?? {},
            startedAt: Date.now(),
            events: [],
            metrics: emptyMetrics(),
            pendingRequests: [],
            answeredRequests: new Map(),
            createdBy: (params.createdBy as string) ?? undefined,
            parentThinkrailSid: (params.parentThinkrailSid as string) ?? null,
            subsessionType: (params.subsessionType as Session["subsessionType"]) ?? null,
            subsessionContext: (params.subsessionContext as string) ?? null,
            subsessionOrigin: (params.subsessionOrigin as Session["subsessionOrigin"]) ?? null,
            returnStatus: null,
            returnSummary: null,
            artifacts: [],
            previewPath: null,
            previewSection: null,
            subagentMode,
            stepGate,
          };
      next.set(thinkrailSid, session);
      return { sessions: next };
    });
  },

  onRemoteUserMessage: (params) => {
    const thinkrailSid = params.thinkrailSid as string;
    const text = params.text as string;
    const isMarkdown = (params.isMarkdown as boolean) ?? false;
    set((s) => {
      const session = s.sessions.get(thinkrailSid);
      if (!session) return s;
      // Skip if we already have this message (sent by us optimistically)
      const lastEvent = session.events[session.events.length - 1];
      if (
        lastEvent?.eventType === EventType.UserMessage &&
        (lastEvent.payload.text as string) === text
      ) {
        return s;
      }
      const next = new Map(s.sessions);
      next.set(thinkrailSid, {
        ...session,
        events: [
          ...session.events,
          {
            thinkrailSid,
            sessionId: "",
            eventType: "userMessage" as const,
            payload: { text, isMarkdown },
          },
        ],
      });
      return { sessions: next };
    });
  },

  onSessionDone: (params) => {
    const thinkrailSid = params.thinkrailSid as string;
    set((s) => {
      const sessions = appendEvent(s.sessions, thinkrailSid, "agent/done", params, s.closedIds);
      const session = sessions.get(thinkrailSid);
      if (session) {
        // agent/done carries no usage/context data — only update
        // cost, status, and duration.  Preserve context from the
        // last turnComplete so the display doesn't blank out.
        const newCost = (params.costUsd as number) ?? session.metrics.costUsd;
        // Outcome is bundled into agent/done so the status flip and the
        // next-step contract land in the same render cycle — no flash
        // of a "session ended" view between the two notifications.
        const payloadOutcome = (params.outcome as Session["outcome"]) ?? null;
        sessions.set(thinkrailSid, {
          ...session,
          status: "done",
          pendingRequests: [],
          metrics: {
            ...session.metrics,
            costUsd: newCost,
            turns: (params.turns as number) ?? session.metrics.turns,
            durationMs: (params.durationMs as number) ?? session.metrics.durationMs,
            contextUsage: { ...session.metrics.contextUsage, liveTurn: null },
          },
          outcome: payloadOutcome ?? session.outcome ?? null,
        });
      }
      return { sessions };
    });
  },

  onSessionError: (params) => {
    const thinkrailSid = params.thinkrailSid as string;
    const subtype = params.subtype as string;
    const isRecoverable = subtype === "turn_error" || subtype === "context_overflow";
    set((s) => {
      const sessions = appendEvent(s.sessions, thinkrailSid, "agent/error", params, s.closedIds);
      const session = sessions.get(thinkrailSid);
      if (session) {
        sessions.set(thinkrailSid, {
          ...session,
          status: isRecoverable ? "idle" : "error",
          pendingRequests: [],
          metrics: {
            ...session.metrics,
            contextUsage: { ...session.metrics.contextUsage, liveTurn: null },
          },
        });
      }
      return { sessions };
    });
  },

  // ── Subsession actions ──

  createSubsession: async (parentThinkrailSid, type, context, name, origin) => {
    const { createSubsessionApi } = await import("@/api/methods/subsessions.ts");
    const client = getClient();
    const api = createSubsessionApi(client);

    const { thinkrailSid } = await api.create({
      parentThinkrailSid,
      type,
      context,
      name: name ?? (type === "discussion" ? "Discussion" : "Refinement"),
      origin,
    });

    // Load the created subsession from backend
    const { createSessionApi } = await import("@/api/methods/sessions.ts");
    const sessionApi = createSessionApi(client);
    const data = await sessionApi.get(thinkrailSid);

    if (data) {
      // Check if this session has a live backend runner
      const allSessions = await sessionApi.list();
      const backendEntry = allSessions.find((s) => s.thinkrailSid === thinkrailSid);
      const isActive = backendEntry?.active === true;

      // Convert backend events to AgentEvent format
      const events: AgentEvent[] = (data.events ?? []).map((ev: Record<string, unknown>) => ({
        thinkrailSid,
        sessionId: ((ev.payload as Record<string, unknown>)?.sessionId as string) ?? "",
        eventType: ((ev.eventType as string) ?? "notification") as AgentEvent["eventType"],
        payload: (ev.payload as Record<string, unknown>) ?? ev,
      } as unknown as AgentEvent));

      const restoredCost = reconstructCost(events);
      const restoredModel = (data.config?.model as string) ?? "";
      const diskMetrics = (data?.metrics ?? {}) as Record<string, unknown>;
      const restoredCtx = reconstructContextUsage(events, (diskMetrics.contextMax as number) ?? 0);

      const session: Session = {
        thinkrailSid,
        name: data.name ?? thinkrailSid.slice(0, 8),
        skillId: (data.skillId as string) ?? null,
        specIds: data.specIds ?? [],
        filePaths: (data.filePaths as string[]) ?? [],
        status: isActive
          ? ((backendEntry?.status as SessionStatus) ?? "idle")
          : "done",
        model: restoredModel,
        permissionMode: (data.config?.permissionMode as string) ?? "default",
        effort: (data.config?.effort as string) ?? "auto",
        flags: (data.config?.flags as Record<string, boolean>) ?? {},
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
        pendingRequests: [],
        answeredRequests: new Map(),
        restored: !isActive,
        parentThinkrailSid: (data as unknown as Record<string, unknown>).parentThinkrailSid as string ?? parentThinkrailSid,
        subsessionType: (data as unknown as Record<string, unknown>).subsessionType as Session["subsessionType"] ?? type,
        subsessionContext: (data as unknown as Record<string, unknown>).subsessionContext as string ?? context ?? null,
        subsessionOrigin: (data as unknown as Record<string, unknown>).subsessionOrigin as Session["subsessionOrigin"] ?? origin ?? null,
        returnStatus: (data as unknown as Record<string, unknown>).returnStatus as Session["returnStatus"] ?? null,
        returnSummary: (data as unknown as Record<string, unknown>).returnSummary as string ?? null,
        outcome: ((data as unknown as Record<string, unknown>).outcome as Session["outcome"]) ?? null,
        artifacts: dedupArtifacts(
          ((data as unknown as Record<string, unknown>).artifacts as SessionArtifact[]) ?? [],
        ),
        previewPath:
          ((data as unknown as Record<string, unknown>).previewPath as string | null) ?? null,
        previewSection: null,
      };

      set((s) => {
        const next = new Map(s.sessions);
        next.set(thinkrailSid, session);
        const tabs = new Set(s.openTabs);
        tabs.add(thinkrailSid);
        return { sessions: next, openTabs: tabs, activeSessionId: thinkrailSid };
      });
    }
    return thinkrailSid;
  },

  approveReturn: async (thinkrailSid, text) => {
    const { createSubsessionApi } = await import("@/api/methods/subsessions.ts");
    const api = createSubsessionApi(getClient());
    await api.approveSummary(thinkrailSid, text);
    set((s) => {
      const session = s.sessions.get(thinkrailSid);
      if (!session) return s;
      const next = new Map(s.sessions);
      next.set(thinkrailSid, { ...session, returnStatus: SessionReturnStatus.Approved, returnSummary: text });
      return { sessions: next };
    });
  },

  dismissReturn: async (thinkrailSid) => {
    const { createSubsessionApi } = await import("@/api/methods/subsessions.ts");
    const api = createSubsessionApi(getClient());
    await api.dismissSummary(thinkrailSid);
    set((s) => {
      const session = s.sessions.get(thinkrailSid);
      if (!session) return s;
      const next = new Map(s.sessions);
      next.set(thinkrailSid, { ...session, returnStatus: SessionReturnStatus.Dismissed });
      return { sessions: next };
    });
  },

  reviseReturn: async (thinkrailSid, feedback) => {
    const { createSubsessionApi } = await import("@/api/methods/subsessions.ts");
    const api = createSubsessionApi(getClient());
    await api.reviseSummary(thinkrailSid, feedback);
  },

  onSubsessionReturned: (params) => {
    const p = params as Record<string, unknown>;
    const parentSid = p.parentThinkrailSid as string;
    const subsessionType = p.type as string;
    const summary = p.summary as string;

    if (subsessionType === "refinement") {
      // Refinement: replace parent's input box text with revised message
      useInputDraftStore.getState().setDraft(parentSid, summary);
      // Switch to parent tab so user sees the revised text in the input box
      set(() => ({ activeSessionId: parentSid }));
    } else {
      // Discussion: route the summary by origin (a still-pending question's
      // "Other" field, else the parent's message box), post a result card,
      // switch to the parent, and close (archive) the child tab.
      const origin = p.origin as { kind?: string; requestId?: string } | undefined;
      const parent = get().sessions.get(parentSid);
      const questionStillPending = !!(
        origin?.requestId &&
        parent?.pendingRequests?.some((r) => r.requestId === origin.requestId)
      );
      if (origin?.kind === "question" && questionStillPending && origin.requestId) {
        useAnswerDraftStore.getState().setDraft(origin.requestId, summary);
      } else {
        useInputDraftStore.getState().setDraft(parentSid, summary);
      }
      set((s) => {
        const parent = s.sessions.get(parentSid);
        if (!parent) return { activeSessionId: parentSid };
        const next = new Map(s.sessions);
        const event = {
          thinkrailSid: parentSid,
          sessionId: "",
          eventType: "notification" as const,
          payload: {
            type: "subsessionResult",
            childThinkRailSid: p.childThinkRailSid,
            childName: p.childName ?? "Subsession",
            subsessionType: p.type,
            summary,
          },
        };
        next.set(parentSid, { ...parent, events: [...parent.events, event] });
        return { sessions: next, activeSessionId: parentSid };
      });
      const childSid = p.childThinkRailSid as string | undefined;
      if (childSid) get().closeSession(childSid);
    }
  },

  onSummaryDrafted: (params) => {
    const p = params as Record<string, unknown>;
    const sid = p.thinkrailSid as string;
    set((s) => {
      const session = s.sessions.get(sid);
      if (!session) return s;
      const next = new Map(s.sessions);
      next.set(sid, {
        ...session,
        returnStatus:
          (p.returnStatus as Session["returnStatus"]) ?? SessionReturnStatus.Pending,
        returnSummary: (p.returnSummary as string) ?? null,
      });
      return { sessions: next };
    });
  },

  requestReturnSummary: async (thinkrailSid) => {
    const { createSubsessionApi } = await import("@/api/methods/subsessions.ts");
    const api = createSubsessionApi(getClient());
    await api.requestSummary(thinkrailSid);
    set((s) => {
      const session = s.sessions.get(thinkrailSid);
      if (!session) return s;
      const next = new Map(s.sessions);
      // Clear any prior summary so the dialog shows the "drafting" state until
      // the fresh draft arrives (also drives Regenerate).
      next.set(thinkrailSid, {
        ...session,
        returnStatus: SessionReturnStatus.Pending,
        returnSummary: null,
      });
      return { sessions: next };
    });
  },

}));

// Route draft-on-type autosave commits (debounce / max-wait / flush) to the
// store's commitDraft action.
draftAutosave.setCommitFn((thinkrailSid) => useSessionStore.getState().commitDraft(thinkrailSid));

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
      if (isTransient(session.status)) {
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

