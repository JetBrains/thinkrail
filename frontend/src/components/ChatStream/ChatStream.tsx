import { useCallback, useEffect, useRef, useState, forwardRef, useImperativeHandle } from "react";
import type { AgentEvent, AskUserQuestionEvent } from "@/types/agent.ts";
import type { Session } from "@/types/session.ts";
import { DraftConfigCard } from "./DraftConfigCard.tsx";
import { useViewMode, type ViewMode } from "@/context/ViewModeContext.tsx";
import { useSettingsStore } from "@/store/settingsStore.ts";
import { useSessionStore } from "@/store/sessionStore.ts";
import { renderEvent } from "./renderers/registry.ts";
import { SessionContextMenu } from "./SessionContextMenu.tsx";
import { SubsessionContextMenu } from "./SubsessionContextMenu.tsx";
import { ReturnFlowCard } from "./ReturnFlowCard.tsx";
import type { ApprovalInfo, EventRenderContext } from "./renderers/types.ts";
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
  onApplyDescription,
}, ref) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const autoScroll = useRef(true);
  const viewMode = useViewMode();

  // ── Context menu state ──
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; questionRequestId?: string } | null>(null);

  // Auto-scroll to bottom on new events
  useEffect(() => {
    if (autoScroll.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events.length]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    autoScroll.current = distFromBottom < 50;
  }, []);

  useImperativeHandle(ref, () => ({
    scrollToTop() {
      scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
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
    document.dispatchEvent(new CustomEvent("bonsai:expandAll"));
  }, []);

  const handleCollapseEvents = useCallback(() => {
    document.dispatchEvent(new CustomEvent("bonsai:collapseEvents"));
  }, []);

  const handleCollapseAll = useCallback(() => {
    document.dispatchEvent(new CustomEvent("bonsai:collapseAll"));
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
    useSessionStore.getState().sendMessage(session.bonsaiSid, msg);
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

  // ── Pre-scan: track latest bonsai_visualize event per visId ──
  const latestVisByVisId = new Map<string, number>();
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    if (ev.eventType === "toolCallStart" && ev.payload.toolName.endsWith("bonsai_visualize")) {
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
        ev.payload.toolName.endsWith("bonsai_visualize");
      const isInteraction = ev.eventType === "askUserQuestion" || ev.eventType === "confirmAction" || ev.eventType === "suggestSession" || ev.eventType === "suggestDescription";
      if (!isVis && !isInteraction) {
        subagentChildren.get(parentIdx)!.push(i);
        childIndices.add(i);
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

  // ── Build render context ──
  const ctx: EventRenderContext = {
    toolStates,
    activeSubagents,
    subagentChildren,
    latestVisByVisId,
    approvalByToolIndex,
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
        <DraftConfigCard bonsaiSid={session.bonsaiSid} />
      )}
      {events.map((ev, i) => {
        if (childIndices.has(i)) return null;
        const k = `${i}-${ev.eventType}`;
        return renderEvent(viewMode, ev, i, k, ctx);
      })}

      {session?.returnStatus === "pending" && session?.returnSummary && (
        <ReturnFlowCard
          bonsaiSid={session.bonsaiSid}
          subsessionType={session.subsessionType ?? "discussion"}
          proposedSummary={session.returnSummary}
          onApprove={(text) => {
            import("@/store/sessionStore.ts").then(({ useSessionStore }) => {
              useSessionStore.getState().approveReturn(session.bonsaiSid, text);
            }).catch(console.error);
          }}
          onDismiss={() => {
            import("@/store/sessionStore.ts").then(({ useSessionStore }) => {
              useSessionStore.getState().dismissReturn(session.bonsaiSid);
            }).catch(console.error);
          }}
          onRevise={(feedback) => {
            import("@/store/sessionStore.ts").then(({ useSessionStore }) => {
              useSessionStore.getState().reviseReturn(session.bonsaiSid, feedback);
            }).catch(console.error);
          }}
        />
      )}

      <SubsessionContextMenu containerRef={scrollRef} sessionId={session?.bonsaiSid ?? ""} />

      {!autoScroll.current && (
        <button
          className="chat-jump-btn"
          onClick={() => {
            autoScroll.current = true;
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
