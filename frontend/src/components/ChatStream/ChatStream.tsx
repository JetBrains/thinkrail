import { lazy, Suspense, useCallback, useEffect, useRef, useState, forwardRef, useImperativeHandle } from "react";
import type { AgentEvent } from "@/types/agent.ts";
import type { Session } from "@/types/session.ts";
import { useSessionStore } from "@/store/sessionStore.ts";
import { SystemMessage } from "./SystemMessage.tsx";
import { AssistantMessage } from "./AssistantMessage.tsx";
import { ToolCallCard } from "./ToolCallCard.tsx";
import { SessionContextCard } from "./SessionContextCard.tsx";
import { DraftConfigCard } from "./DraftConfigCard.tsx";
import { VisualizationCard, VisErrorBoundary } from "./VisualizationCard.tsx";
import { SubagentBlock } from "./SubagentBlock.tsx";
import { QuestionCard } from "./QuestionCard.tsx";
import { ApprovalCard } from "./ApprovalCard.tsx";
import { PlanApprovalCard } from "./PlanApprovalCard.tsx";
import SuggestionCard from "./SuggestionCard.tsx";
import DescriptionSuggestionCard from "./DescriptionSuggestionCard.tsx";
import { CompletionBanner } from "./CompletionBanner.tsx";
import { ErrorBanner } from "./ErrorBanner.tsx";
import { CompactMarker } from "./CompactMarker.tsx";
import { ChatMarkdown } from "./ChatMarkdown.tsx";
import type { VisData } from "@/types/vis.ts";

const DIFF_TOOLS = new Set(["Edit", "Write", "NotebookEdit"]);
const DiffCard = lazy(() => import("./DiffCard.tsx").then(m => ({ default: m.DiffCard })));

/** User message bubble with optional markdown rendering and raw/rendered toggle. */
function UserMessageBubble({ text, isMarkdown }: { text: string; isMarkdown: boolean }) {
  const [showRaw, setShowRaw] = useState(false);

  if (!isMarkdown) {
    return (
      <div className="chat-user">
        <div className="chat-user-text">{text}</div>
      </div>
    );
  }

  return (
    <div className="chat-user">
      <div className="chat-user-bubble">
        {showRaw ? (
          <div className="chat-user-text">{text}</div>
        ) : (
          <div className="chat-user-text--md">
            <ChatMarkdown content={text} />
          </div>
        )}
        <button
          className="chat-user-toggle"
          onClick={() => setShowRaw((v) => !v)}
          title={showRaw ? "Show rendered" : "Show raw"}
        >
          {showRaw ? "md" : "raw"}
        </button>
      </div>
    </div>
  );
}

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

  // Pre-scan: index toolCallEnd results by toolUseId so that
  // when rendering a toolCallStart we can show its output inline.
  const toolStates = new Map<string, ToolState>();
  for (const ev of events) {
    if (ev.eventType === "toolCallEnd") {
      const id = (ev.payload.toolUseId as string) ?? "";
      toolStates.set(id, {
        output: (ev.payload.output as string) ?? "",
        isError: (ev.payload.isError as boolean) ?? false,
        finished: true,
      });
    }
  }

  // Pre-scan: track which subagents are still running (started but not ended).
  // interrupted / turnComplete implicitly close all open subagents because
  // the SDK's SubagentStop hook isn't guaranteed to fire on interrupt.
  const activeSubagents = new Set<string>();
  for (const ev of events) {
    if (ev.eventType === "subagentStart")
      activeSubagents.add(ev.payload.agentId as string);
    if (ev.eventType === "subagentEnd")
      activeSubagents.delete(ev.payload.agentId as string);
    if (ev.eventType === "interrupted" || ev.eventType === "turnComplete")
      activeSubagents.clear();
  }

  // Pre-scan: track latest bonsai_visualize event per visId for hybrid collapse.
  const latestVisByVisId = new Map<string, number>();
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    if (ev.eventType === "toolCallStart" && (ev.payload.toolName as string)?.endsWith("bonsai_visualize")) {
      const visId = (ev.payload.toolInput as Record<string, unknown>)?.visId as string | undefined;
      if (visId) latestVisByVisId.set(visId, i);
    }
  }

  // Pre-scan: group child events under their parent subagentStart using
  // explicit agentId from backend (resolved via SDK parent_tool_use_id).
  const subagentChildren = new Map<number, number[]>(); // subagentStart idx → child idxs
  const childIndices = new Set<number>();               // events to skip in render
  {
    // First pass: map agentId → subagentStart event index.
    // Agent IDs are unique random strings, so the mapping persists across
    // turn boundaries (interrupted / turnComplete) without collision risk.
    // Previously this map was cleared on turn-end events, which broke
    // subagent grouping when events were replayed after an interrupt.
    const agentStartIdx = new Map<string, number>();
    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      if (ev.eventType === "subagentStart") {
        const aid = (ev.payload.agentId as string) ?? "";
        agentStartIdx.set(aid, i);
        subagentChildren.set(i, []);
      }
    }

    // Second pass: assign child events to their parent subagentStart via agentId
    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      if (ev.eventType === "subagentStart" || ev.eventType === "subagentEnd"
          || ev.eventType === "interrupted" || ev.eventType === "turnComplete")
        continue;

      const agentId = ev.payload.agentId as string | undefined;
      if (!agentId) continue;

      const parentIdx = agentStartIdx.get(agentId);
      if (parentIdx === undefined) continue;

      // Hoist bonsai_visualize, askUserQuestion, confirmAction, and suggestSession
      // to top level so they remain visible outside the collapsible SubagentBlock
      const isVis = ev.eventType === "toolCallStart" &&
        (ev.payload.toolName as string)?.endsWith("bonsai_visualize");
      const isInteraction = ev.eventType === "askUserQuestion" || ev.eventType === "confirmAction" || ev.eventType === "suggestSession" || ev.eventType === "suggestDescription";
      if (!isVis && !isInteraction) {
        subagentChildren.get(parentIdx)!.push(i);
        childIndices.add(i);
      }
    }
  }

  return (
    <div className="chat-stream" ref={scrollRef} onScroll={handleScroll}>
      {session?.status === "draft" && (
        <DraftConfigCard bonsaiSid={session.bonsaiSid} />
      )}
      {events.map((ev, i) => {
        // Skip events that are children of a subagent (rendered inside SubagentBlock)
        if (childIndices.has(i)) return null;
        const p = ev.payload;
        const k = `${i}-${ev.eventType}`;
        switch (ev.eventType) {
          case "sessionStart":
            return (
              <SessionContextCard
                key={k}
                skillId={session?.skillId ?? undefined}
                specIds={session?.specIds ?? []}
                model={(p.model as string) ?? session?.model ?? "agent"}
                permissionMode={session?.permissionMode ?? "default"}
                betas={session?.betas ?? []}
                systemPrompt={session?.systemPrompt ?? (p.systemPrompt as string) ?? undefined}
                onVisibilityChange={onContextCardVisibility}
              />
            );

          case "userMessage":
            return (
              <UserMessageBubble
                key={k}
                text={(p.text as string) ?? ""}
                isMarkdown={(p.isMarkdown as boolean) ?? false}
              />
            );

          case "textDelta":
            return (
              <AssistantMessage
                key={k}
                text={(p.text as string) ?? ""}
                streaming={(p.streaming as boolean) ?? false}
              />
            );

          case "toolCallStart": {
            if ((p.toolName as string) === "AskUserQuestion") return null;
            // MCP tools may be prefixed with server name (e.g. mcp__bonsai-vis__bonsai_visualize)
            if ((p.toolName as string)?.endsWith("bonsai_visualize")) {
              const visInput = p.toolInput as VisData | undefined;
              // LLMs sometimes pass `data` as a JSON string instead of an object — auto-parse it
              if (visInput && typeof visInput.data === "string") {
                try {
                  visInput.data = JSON.parse(visInput.data);
                } catch {
                  // Repair attempt: LLMs double-serializing often produce \\" instead
                  // of \\\" inside nested strings — fix the escaping and retry.
                  try {
                    const repaired = (visInput.data as unknown as string).replace(/\\"/g, '\\\\"');
                    visInput.data = JSON.parse(repaired);
                  } catch {
                    // Still failed — mark as parse error so the card shows an error
                    // message instead of rendering blank content
                    visInput.data = { _parseError: true } as any;
                  }
                }
              }
              if (visInput) {
                const visId = visInput.visId;
                const isLatest = !visId || latestVisByVisId.get(visId) === i;
                return (
                  <VisErrorBoundary key={k}>
                    <VisualizationCard
                      data={visInput}
                      collapsed={!isLatest}
                    />
                  </VisErrorBoundary>
                );
              }
            }
            const toolName = (p.toolName as string) ?? "tool";
            const toolUseId = (p.toolUseId as string) ?? "";
            const end = toolStates.get(toolUseId);
            const state = end?.finished ? (end.isError ? "error" as const : "success" as const) : "running" as const;
            if (DIFF_TOOLS.has(toolName)) {
              return (
                <Suspense key={k} fallback={<ToolCallCard toolName={toolName} toolInput={extractToolInput(p.toolInput)} state="running" />}>
                  <DiffCard
                    toolName={toolName}
                    toolInput={(p.toolInput as Record<string, unknown>) ?? {}}
                    output={end?.output}
                    isError={end?.isError}
                    state={state}
                  />
                </Suspense>
              );
            }
            return (
              <ToolCallCard
                key={k}
                toolName={toolName}
                toolInput={extractToolInput(p.toolInput)}
                output={end?.output}
                isError={end?.isError}
                state={state}
              />
            );
          }

          case "toolCallEnd":
            return null; // Handled by toolCallStart pairing

          case "subagentStart": {
            const cEvents = (subagentChildren.get(i) ?? []).map(idx => events[idx]);
            return (
              <SubagentBlock
                key={k}
                agentType={(p.agentType as string) ?? undefined}
                finished={!activeSubagents.has(p.agentId as string)}
                childEvents={cEvents}
                toolStates={toolStates}
              />
            );
          }

          case "subagentEnd":
            return null; // Handled by subagentStart

          case "askUserQuestion": {
            const questions = (p.questions as AgentEvent["payload"][]) ?? [];
            const requestId = (p.requestId as string) ?? "";
            const isAnswered = answeredRequests.has(requestId);
            const savedAnswer = answeredRequests.get(requestId) as Record<string, unknown> | undefined;
            const qInterrupted = savedAnswer?.interrupt === true;
            return (
              <QuestionCard
                key={k}
                questions={questions as never}
                answered={isAnswered}
                interrupted={qInterrupted}
                selectedAnswers={isAnswered ? (savedAnswer?.answers as Record<string, string>) : undefined}
                onSubmit={(response) => onResolveRequest(requestId, response)}
              />
            );
          }

          case "confirmAction": {
            const requestId = (p.requestId as string) ?? "";
            const isAnswered = answeredRequests.has(requestId);
            const savedResponse = answeredRequests.get(requestId) as Record<string, unknown> | undefined;
            const aInterrupted = savedResponse?.interrupt === true;
            const decision = savedResponse?.behavior === "allow" ? "approve" as const : "deny" as const;

            // ExitPlanMode gets a dedicated plan review card
            if ((p.toolName as string) === "ExitPlanMode") {
              const toolInput = p.toolInput as Record<string, unknown> | undefined;
              return (
                <PlanApprovalCard
                  key={k}
                  planContent={(toolInput?.plan as string) ?? undefined}
                  allowedPrompts={(toolInput?.allowedPrompts as Array<{ tool: "Bash"; prompt: string }>) ?? undefined}
                  answered={isAnswered}
                  decision={isAnswered ? decision : undefined}
                  interrupted={aInterrupted}
                  onApprove={() =>
                    onResolveRequest(requestId, { behavior: "allow" })
                  }
                  rejectionReason={
                    isAnswered && decision === "deny" && !aInterrupted
                      ? (savedResponse?.rejectionReason as string) ?? undefined
                      : undefined
                  }
                  onDeny={(reason?: string) => {
                    onResolveRequest(requestId, {
                      behavior: "deny",
                      message: reason
                        ? `Plan rejected: ${reason}`
                        : "Plan rejected",
                      interrupt: false,
                      rejectionReason: reason ?? "",
                    });
                  }}
                />
              );
            }

            return (
              <ApprovalCard
                key={k}
                toolName={(p.toolName as string) ?? "action"}
                toolInput={p.toolInput ?? undefined}
                description={(p.description as string) ?? undefined}
                answered={isAnswered}
                decision={isAnswered ? decision : undefined}
                interrupted={aInterrupted}
                onApprove={() =>
                  onResolveRequest(requestId, { behavior: "allow" })
                }
                onDeny={() =>
                  onResolveRequest(requestId, {
                    behavior: "deny",
                    message: "User denied",
                    interrupt: false,
                  })
                }
              />
            );
          }

          case "suggestSession": {
            const requestId = (p.requestId as string) ?? "";
            const isAnswered = answeredRequests.has(requestId);
            const savedResponse = answeredRequests.get(requestId) as Record<string, unknown> | undefined;
            const decision = savedResponse?.behavior === "allow" ? "approved" as const : "dismissed" as const;

            return (
              <SuggestionCard
                key={k}
                skill={(p.skill as string) ?? ""}
                specIds={(p.specIds as string[]) ?? []}
                name={(p.name as string) ?? ""}
                reason={(p.reason as string) ?? ""}
                prompt={(p.prompt as string) ?? undefined}
                answered={isAnswered}
                decision={isAnswered ? decision : undefined}
                dismissReason={
                  isAnswered && decision === "dismissed"
                    ? (savedResponse?.dismissReason as string) ?? undefined
                    : undefined
                }
                onApprove={async () => {
                  onResolveRequest(requestId, { behavior: "allow" });
                  // Create the suggested session and auto-switch to it
                  const store = useSessionStore.getState();
                  const currentSession = session;
                  try {
                    const newSid = await store.startSession({
                      skillId: (p.skill as string) ?? undefined,
                      specIds: (p.specIds as string[]) ?? [],
                      prompt: (p.prompt as string) ?? undefined,
                      name: (p.name as string) ?? "Suggested Session",
                      config: {
                        model: currentSession?.model ?? "sonnet",
                        maxTurns: currentSession?.maxTurns ?? 50,
                        permissionMode: currentSession?.permissionMode ?? "default",
                        streamText: true,
                        betas: currentSession?.betas ?? [],
                        effort: currentSession?.effort ?? null,
                      },
                    });
                    store.switchSession(newSid);
                  } catch (err) {
                    console.error("[SuggestionCard] Failed to start suggested session:", err);
                  }
                }}
                onDismiss={(reason) =>
                  onResolveRequest(requestId, {
                    behavior: "deny",
                    message: reason
                      ? `Dismissed: ${reason}`
                      : "Dismissed",
                    dismissReason: reason ?? "",
                  })
                }
              />
            );
          }

          case "suggestDescription": {
            const requestId = (p.requestId as string) ?? "";
            const isAnswered = answeredRequests.has(requestId);
            const savedResponse = answeredRequests.get(requestId) as Record<string, unknown> | undefined;
            const decision = savedResponse?.behavior === "allow" ? "applied" as const : "dismissed" as const;
            const descText = (p.description as string) ?? "";

            return (
              <DescriptionSuggestionCard
                key={k}
                description={descText}
                section={(p.section as string) ?? undefined}
                answered={isAnswered}
                decision={isAnswered ? decision : undefined}
                dismissReason={
                  isAnswered && decision === "dismissed"
                    ? (savedResponse?.dismissReason as string) ?? undefined
                    : undefined
                }
                onApply={() => {
                  onResolveRequest(requestId, { behavior: "allow" });
                  onApplyDescription?.(descText);
                }}
                onDismiss={(reason) =>
                  onResolveRequest(requestId, {
                    behavior: "deny",
                    message: reason
                      ? `Dismissed: ${reason}`
                      : "Dismissed",
                    dismissReason: reason ?? "",
                  })
                }
              />
            );
          }

          case "turnComplete": {
            return (
              <SystemMessage
                key={k}
                text={`Turn complete \u2014 $${((p.turnCostUsd as number) ?? 0).toFixed(2)} \u00B7 ${(p.turn_turns as number) ?? 0} turns`}
                variant="ok"
              />
            );
          }

          case "interrupted":
            return (
              <SystemMessage
                key={k}
                text="Turn interrupted"
              />
            );

          case "done":
            return (
              <CompletionBanner
                key={k}
                costUsd={(p.costUsd as number) ?? undefined}
                turns={(p.turns as number) ?? undefined}
                durationMs={(p.durationMs as number) ?? undefined}
              />
            );

          case "error":
            return (
              <ErrorBanner
                key={k}
                subtype={(p.subtype as string) ?? undefined}
                errors={(p.errors as string[]) ?? undefined}
              />
            );

          case "notification":
            return (
              <SystemMessage
                key={k}
                text={(p.message as string) ?? ""}
              />
            );

          case "compact":
            return (
              <CompactMarker
                key={k}
                preTokens={(p.preTokens as number) ?? undefined}
              />
            );

          case "permissionDenied":
            return (
              <div key={k} className="chat-banner chat-banner-warn">
                Permission denied: {(p.toolName as string) ?? "action"}
              </div>
            );

          case "requestResolved":
            return null;

          default:
            return null;
        }
      })}

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
    </div>
  );
});
