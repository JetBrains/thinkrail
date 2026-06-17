import { useCallback, useEffect, useRef, useState, forwardRef, useImperativeHandle } from "react";
import type { AgentEvent, AskUserQuestionEvent } from "@/types/agent.ts";
import type { Session } from "@/types/session.ts";
import { DraftConfigCard } from "./DraftConfigCard.tsx";
import { useViewMode, type ViewMode } from "@/context/ViewModeContext.tsx";
import { useSettingsStore } from "@/store/settingsStore.ts";
import { useSessionStore } from "@/store/sessionStore.ts";
import { renderEvent } from "./renderers/registry.ts";
import { getEventCategory } from "./renderers/categories.ts";
import { useUiStore } from "@/store/uiStore.ts";
import { ProposeChangeChip, type HunkSummary } from "./ProposeChangeChip.tsx";
import { SessionContextMenu } from "./SessionContextMenu.tsx";
import { SubsessionContextMenu } from "./SubsessionContextMenu.tsx";
import { ReturnFlowCard } from "./ReturnFlowCard.tsx";
import {
  EXPAND_ALL_EVENT,
  COLLAPSE_EVENTS_EVENT,
  COLLAPSE_ALL_EVENT,
} from "./useExpandCollapse.ts";
import type { ApprovalInfo, EventRenderContext, TaskItem } from "./renderers/types.ts";
import { getClient } from "@/api/index.ts";
import { createBoardApi } from "@/api/methods/board.ts";
import "./compact.css";

/** Shared type for tool call end-state, used by SubagentBlock too. */
export type ToolState = { output?: string; isError?: boolean; finished: boolean };

/** Extract a displayable string from a toolInput payload value. */
export function extractToolInput(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (typeof raw === "object" && raw) {
    const val = Object.values(raw as Record<string, unknown>)[0];
    const str = val?.toString() ?? "";
    return str.includes("[object Object]") ? "" : str;
  }
  return "";
}

/** Walk up from a target element to find the nearest data-question-request-id. */
function findQuestionRequestId(target: HTMLElement): string | null {
  let el: HTMLElement | null = target;
  while (el) {
    const rid = el.dataset.questionRequestId;
    if (rid) return rid;
    el = el.parentElement;
  }
  return null;
}

/** Build a plain-text transcript from events. */
function buildTranscript(events: AgentEvent[]): string {
  const lines: string[] = [];
  for (const ev of events) {
    switch (ev.eventType) {
      case "userMessage":
        lines.push(`You: ${ev.payload.text}`);
        break;
      case "textDelta":
        lines.push(ev.payload.text);
        break;
      case "toolCallStart":
        lines.push(`[${ev.payload.toolName}]`);
        break;
      case "notification":
        lines.push(`> ${ev.payload.message ?? ""}`);
        break;
    }
  }
  return lines.filter(Boolean).join("\n");
}

export interface ChatStreamHandle {
  scrollToTop: () => void;
  scrollToEvent: (index: number) => void;
}

interface ChatStreamProps {
  events: AgentEvent[];
  answeredRequests: Map<string, unknown>;
  onResolveRequest: (requestId: string, response: unknown) => void;
  session?: Session;
  onContextCardVisibility?: (visible: boolean) => void;
  onApplyDescription?: (text: string) => void;
}

export const ChatStream = forwardRef<ChatStreamHandle, ChatStreamProps>(function ChatStream({
  events,
  answeredRequests,
  onResolveRequest,
  session,
  onContextCardVisibility,
  onApplyDescription: onApplyDescriptionProp,
}, ref) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const autoScroll = useRef(true);
  const viewMode = useViewMode();
  const categoryVisibility = useUiStore((s) => s.chatCategoryVisibility);
  const setActiveReview = useUiStore((s) => s.setActiveReview);

  // ── Context menu state ──
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; questionRequestId?: string } | null>(null);

  const [showJumpButton, setShowJumpButton] = useState(false);
  // Auto-scroll to bottom on new events
  useEffect(() => {
    if (autoScroll.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events.length]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
    autoScroll.current = atBottom;
    setShowJumpButton(!atBottom);
  }, []);

  useImperativeHandle(ref, () => ({
    scrollToTop() {
      scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    },
    scrollToEvent(index: number) {
      const container = scrollRef.current;
      if (!container) return;
      const el = container.querySelector<HTMLElement>(`[data-event-index="${index}"]`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    },
  }));

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    // If there's selected text, let SubsessionContextMenu handle it instead
    const selection = window.getSelection();
    if (selection?.toString().trim()) return;
    e.preventDefault();
    const questionRequestId = findQuestionRequestId(e.target as HTMLElement) ?? undefined;
    setCtxMenu({ x: e.clientX, y: e.clientY, questionRequestId });
  }, []);

  const handleSwitchViewMode = useCallback((mode: ViewMode) => {
    useSettingsStore.getState().updateSettings({ event_view: mode });
  }, []);

  const handleExpandAll = useCallback(() => {
    document.dispatchEvent(new CustomEvent(EXPAND_ALL_EVENT));
  }, []);

  const handleCollapseEvents = useCallback(() => {
    document.dispatchEvent(new CustomEvent(COLLAPSE_EVENTS_EVENT));
  }, []);

  const handleCollapseAll = useCallback(() => {
    document.dispatchEvent(new CustomEvent(COLLAPSE_ALL_EVENT));
  }, []);

  const handleCopyTranscript = useCallback(() => {
    const text = buildTranscript(events);
    navigator.clipboard.writeText(text).catch(console.error);
  }, [events]);

  const handleReviseAnswer = useCallback(() => {
    if (!ctxMenu?.questionRequestId || !session) return;
    const requestId = ctxMenu.questionRequestId;
    // Find the question event to get the question text
    const qEvent = events.find(
      (ev): ev is AskUserQuestionEvent => {
        if (ev.eventType !== "askUserQuestion") return false;
        return ev.payload.requestId === requestId;
      },
    );
    if (!qEvent) return;
    const questions = qEvent.payload.questions;
    const savedAnswer = answeredRequests.get(requestId) as Record<string, unknown> | undefined;
    const answers = (savedAnswer?.answers as Record<string, string>) ?? {};

    // Build a revision message
    const parts = questions.map((q) => {
      const prev = answers[q.question];
      return `- "${q.question}": was "${prev ?? "unknown"}"`;
    });
    const msg = `I'd like to revise my answer:\n${parts.join("\n")}\n\nPlease ask me again.`;
    useSessionStore.getState().sendMessage(session.thinkrailSid, msg);
  }, [ctxMenu, session, events, answeredRequests]);

  // ── Pre-scan: index toolCallEnd results by toolUseId ──
  const toolStates = new Map<string, ToolState>();
  for (const ev of events) {
    if (ev.eventType === "toolCallEnd") {
      toolStates.set(ev.payload.toolUseId, {
        output: ev.payload.output,
        isError: ev.payload.isError ?? false,
        finished: true,
      });
    }
  }

  // ── Pre-scan: track which subagents are still running ──
  const activeSubagents = new Set<string>();
  for (const ev of events) {
    if (ev.eventType === "subagentStart")
      activeSubagents.add(ev.payload.agentId);
    if (ev.eventType === "subagentEnd")
      activeSubagents.delete(ev.payload.agentId);
    if (ev.eventType === "interrupted" || ev.eventType === "turnComplete")
      activeSubagents.clear();
  }

  // ── Pre-scan: track latest thinkrail_visualize event per visId ──
  const latestVisByVisId = new Map<string, number>();
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    if (ev.eventType === "toolCallStart" && ev.payload.toolName.endsWith("thinkrail_visualize")) {
      const visId = ev.payload.toolInput.visId as string | undefined;
      if (visId) latestVisByVisId.set(visId, i);
    }
  }

  // ── Pre-scan: group child events under their parent subagentStart ──
  const subagentChildren = new Map<number, number[]>();
  const childIndices = new Set<number>();
  {
    const agentStartIdx = new Map<string, number>();
    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      if (ev.eventType === "subagentStart") {
        agentStartIdx.set(ev.payload.agentId, i);
        subagentChildren.set(i, []);
      }
    }
    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      if (ev.eventType === "subagentStart" || ev.eventType === "subagentEnd"
          || ev.eventType === "interrupted" || ev.eventType === "turnComplete")
        continue;
      // agentId is present on a subset of event types; ReadyEvent.payload is optional
      const agentId = (ev.payload as { agentId?: string | null } | undefined)?.agentId;
      if (!agentId) continue;
      const parentIdx = agentStartIdx.get(agentId);
      if (parentIdx === undefined) continue;
      const isVis = ev.eventType === "toolCallStart" &&
        ev.payload.toolName.endsWith("thinkrail_visualize");
      const isInteraction = ev.eventType === "askUserQuestion" || ev.eventType === "confirmAction" || ev.eventType === "suggestSession" || ev.eventType === "suggestDescription";
      if (!isVis && !isInteraction) {
        subagentChildren.get(parentIdx)!.push(i);
        childIndices.add(i);
      }
    }
  }

  // ── Pre-scan: accumulate Task* events into a single ordered list ──
  // Task ids are assigned sequentially by TaskCreate order ("1", "2", ...);
  // TaskUpdate references them by that id. Subagent task tracking renders
  // inside its SubagentBlock, so child indices are skipped here.
  let taskCollectionAnchor: number | null = null;
  const taskCollection: TaskItem[] = [];
  {
    const taskById = new Map<string, TaskItem>();
    let createCounter = 0;
    for (let i = 0; i < events.length; i++) {
      if (childIndices.has(i)) continue;
      const ev = events[i];
      if (ev.eventType !== "toolCallStart") continue;
      const tn = ev.payload.toolName;
      if (tn !== "TaskCreate" && tn !== "TaskUpdate") continue;
      if (taskCollectionAnchor === null) taskCollectionAnchor = i;

      const input = (ev.payload.toolInput ?? {}) as Record<string, unknown>;
      if (tn === "TaskCreate") {
        createCounter += 1;
        const id = String(createCounter);
        const item: TaskItem = {
          id,
          subject: typeof input.subject === "string" ? input.subject : undefined,
          activeForm: typeof input.activeForm === "string" ? input.activeForm : undefined,
          status: "pending",
        };
        taskById.set(id, item);
        taskCollection.push(item);
      } else {
        const id = typeof input.taskId === "string" ? input.taskId : "";
        if (!id) continue;
        let item = taskById.get(id);
        if (!item) {
          item = { id, status: "pending" };
          taskById.set(id, item);
          taskCollection.push(item);
        }
        const status = typeof input.status === "string" ? input.status : undefined;
        if (status === "deleted") {
          taskById.delete(id);
          const idx = taskCollection.indexOf(item);
          if (idx !== -1) taskCollection.splice(idx, 1);
          continue;
        }
        if (status === "pending" || status === "in_progress" || status === "completed") {
          item.status = status;
        }
        if (typeof input.subject === "string") item.subject = input.subject;
        if (typeof input.activeForm === "string") item.activeForm = input.activeForm;
      }
    }
  }

  // ── Pre-scan: link confirmAction events to their toolCallStart ──
  const approvalByToolIndex = new Map<number, ApprovalInfo>();
  {
    // Pass 1: collect confirmAction events, indexed by toolUseId (preferred) and toolName (fallback)
    const approvalByToolUseId = new Map<string, { eventIndex: number; requestId: string; toolInput?: unknown; description?: string }>();
    const approvalByToolName = new Map<string, { eventIndex: number; requestId: string; toolInput?: unknown; description?: string }[]>();
    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      if (ev.eventType === "confirmAction") {
        const toolName = ev.payload.toolName;
        if (toolName === "ExitPlanMode") continue;
        const entry = {
          eventIndex: i,
          requestId: ev.payload.requestId ?? "",
          toolInput: ev.payload.toolInput,
          description: ev.payload.description ?? undefined,
        };
        const toolUseId = ev.payload.toolUseId ?? "";
        if (toolUseId) {
          approvalByToolUseId.set(toolUseId, entry);
        } else {
          // Legacy events without toolUseId — fallback queue per toolName
          const arr = approvalByToolName.get(toolName) ?? [];
          arr.push(entry);
          approvalByToolName.set(toolName, arr);
        }
      }
    }

    // Pass 2: link toolCallStart events to their approval
    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      if (ev.eventType !== "toolCallStart") continue;
      const toolUseId = ev.payload.toolUseId;
      const toolName = ev.payload.toolName;

      // Prefer exact toolUseId match; fall back to toolName FIFO for legacy events
      let pending = toolUseId ? approvalByToolUseId.get(toolUseId) : undefined;
      if (!pending) {
        const fallbackArr = approvalByToolName.get(toolName);
        if (fallbackArr?.length) {
          pending = fallbackArr.shift();
          if (!fallbackArr.length) approvalByToolName.delete(toolName);
        }
      }

      if (pending) {
        const requestId = pending.requestId;
        const isAnswered = answeredRequests.has(requestId);
        const savedResponse = answeredRequests.get(requestId) as Record<string, unknown> | undefined;
        approvalByToolIndex.set(i, {
          requestId,
          answered: isAnswered,
          decision: isAnswered
            ? (savedResponse?.behavior === "allow" ? "approve" : "deny")
            : undefined,
          interrupted: savedResponse?.interrupt === true,
          toolInput: pending.toolInput,
          description: pending.description,
        });
      }
    }
  }

  // ── Pre-scan: group consecutive proposeChange events by filePath ──
  // Each group renders as one ProposeChangeChip at the first index; subsequent
  // indices in the same group are skipped to avoid duplicate chips.
  const proposeGroups = new Map<number, { filePath: string; indices: number[] }>();
  const proposeFollowers = new Set<number>();
  {
    let i = 0;
    while (i < events.length) {
      const ev = events[i];
      if (ev.eventType !== "proposeChange") {
        i++;
        continue;
      }
      const filePath = (ev.payload as { filePath: string }).filePath;
      const start = i;
      const indices: number[] = [];
      while (
        i < events.length &&
        events[i].eventType === "proposeChange" &&
        (events[i].payload as { filePath: string }).filePath === filePath
      ) {
        indices.push(i);
        i++;
      }
      proposeGroups.set(start, { filePath, indices });
      for (let k = 1; k < indices.length; k++) proposeFollowers.add(indices[k]);
    }
  }

  // When no onApplyDescription is provided (workspace view) but the session
  // is linked to a ticket, auto-apply the description via the board API.
  const onApplyDescription = useCallback((text: string) => {
    if (onApplyDescriptionProp) {
      onApplyDescriptionProp(text);
      return;
    }
    const ticketId = session?.ticketId;
    if (!ticketId) return;
    createBoardApi(getClient()).update(ticketId, { body: text }).catch((e) => {
      console.error("[ChatStream] Failed to apply description to ticket:", e);
    });
  }, [onApplyDescriptionProp, session?.ticketId]);

  // ── Build render context ──
  const ctx: EventRenderContext = {
    toolStates,
    activeSubagents,
    subagentChildren,
    latestVisByVisId,
    approvalByToolIndex,
    taskCollectionAnchor,
    taskCollection,
    answeredRequests,
    onResolveRequest,
    session,
    events,
    onContextCardVisibility,
    onApplyDescription,
  };

  const containerClass = viewMode === "compact"
    ? "chat-stream chat-stream--compact"
    : "chat-stream";

  return (
    <div
      className={containerClass}
      ref={scrollRef}
      onScroll={handleScroll}
      onContextMenu={handleContextMenu}
    >
      {session?.status === "draft" && (
        <DraftConfigCard thinkrailSid={session.thinkrailSid} />
      )}
      {events.map((ev, i) => {
        if (childIndices.has(i)) return null;
        if (proposeFollowers.has(i)) return null;

        // Render a chip at the first index of each proposeChange group.
        if (proposeGroups.has(i) && session) {
          const g = proposeGroups.get(i)!;
          const summaries: HunkSummary[] = g.indices.map((idx) => {
            const p = events[idx].payload as {
              requestId?: string;
              section?: string | null;
              oldString: string;
              newString: string;
            };
            const rid = p.requestId ?? "";
            const resolved = answeredRequests.get(rid) as
              | Record<string, unknown>
              | undefined;
            let state: "pending" | "accepted" | "rejected" = "pending";
            if (resolved) state = resolved.behavior === "allow" ? "accepted" : "rejected";
            return {
              requestId: rid,
              state,
              section: p.section ?? null,
              added: p.newString.split("\n").length,
              removed: p.oldString.split("\n").length,
            };
          });
          const requestIds = g.indices.map(
            (idx) => (events[idx].payload as { requestId?: string }).requestId ?? "",
          );
          const sid = session.thinkrailSid;
          return (
            <div key={`chip-${i}`} data-event-index={i}>
              <ProposeChangeChip
                filePath={g.filePath}
                hunks={summaries}
                onAcceptAll={() =>
                  requestIds.forEach((rid) => {
                    if (rid && !answeredRequests.has(rid))
                      onResolveRequest(rid, { behavior: "allow", applied: "original" });
                  })
                }
                onRejectAll={() =>
                  requestIds.forEach((rid) => {
                    if (rid && !answeredRequests.has(rid))
                      onResolveRequest(rid, { behavior: "deny", discuss: false });
                  })
                }
                onDiscuss={(text) =>
                  requestIds.forEach((rid) => {
                    if (rid && !answeredRequests.has(rid))
                      onResolveRequest(rid, { behavior: "deny", discuss: true, feedback: text });
                  })
                }
                onReview={() => setActiveReview({ sid, filePath: g.filePath })}
              />
            </div>
          );
        }

        // Filter by user's category toggles in SessionStatusLine —
        // except: pending interaction requests (confirmAction, etc.)
        // stay visible regardless of category, because the user has
        // to answer before the agent can continue.  Once answered,
        // they follow the category rule and disappear in dialog mode.
        const category = getEventCategory(ev);
        if (category && !categoryVisibility[category]) {
          const payload = ev.payload as { requestId?: string } | undefined;
          const reqId = payload?.requestId;
          const isPendingInteraction = reqId != null && !answeredRequests.has(reqId);
          if (!isPendingInteraction) return null;
        }
        const k = `${i}-${ev.eventType}`;
        return (
          <div key={k} data-event-index={i}>
            {renderEvent(viewMode, ev, i, k, ctx)}
          </div>
        );
      })}

      {session?.returnStatus === "pending" && session?.returnSummary && (
        <ReturnFlowCard
          thinkrailSid={session.thinkrailSid}
          subsessionType={session.subsessionType ?? "discussion"}
          proposedSummary={session.returnSummary}
          onApprove={(text) => {
            import("@/store/sessionStore.ts").then(({ useSessionStore }) => {
              useSessionStore.getState().approveReturn(session.thinkrailSid, text);
            }).catch(console.error);
          }}
          onDismiss={() => {
            import("@/store/sessionStore.ts").then(({ useSessionStore }) => {
              useSessionStore.getState().dismissReturn(session.thinkrailSid);
            }).catch(console.error);
          }}
          onRevise={(feedback) => {
            import("@/store/sessionStore.ts").then(({ useSessionStore }) => {
              useSessionStore.getState().reviseReturn(session.thinkrailSid, feedback);
            }).catch(console.error);
          }}
        />
      )}

      <SubsessionContextMenu containerRef={scrollRef} sessionId={session?.thinkrailSid ?? ""} />

      {showJumpButton  && (
        <button
          className="chat-jump-btn"
          onClick={() => {
            autoScroll.current = true;
            setShowJumpButton(false);
            scrollRef.current?.scrollTo({
              top: scrollRef.current.scrollHeight,
              behavior: "smooth",
            });
          }}
        >
          Jump to bottom
        </button>
      )}

      {ctxMenu && (
        <SessionContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          viewMode={viewMode}
          onSwitchViewMode={handleSwitchViewMode}
          onExpandAll={handleExpandAll}
          onCollapseEvents={handleCollapseEvents}
          onCollapseAll={handleCollapseAll}
          onCopyTranscript={handleCopyTranscript}
          onReviseAnswer={
            ctxMenu.questionRequestId && answeredRequests.has(ctxMenu.questionRequestId)
              ? handleReviseAnswer
              : undefined
          }
          onClose={() => setCtxMenu(null)}
        />
      )}
    </div>
  );
});
