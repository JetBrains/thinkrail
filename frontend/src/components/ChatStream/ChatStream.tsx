import { useCallback, useEffect, useRef } from "react";
import type { AgentEvent } from "@/types/agent.ts";
import { SystemMessage } from "./SystemMessage.tsx";
import { AssistantMessage } from "./AssistantMessage.tsx";
import { ToolCallCard } from "./ToolCallCard.tsx";
import { VisualizationCard } from "./VisualizationCard.tsx";
import { SubagentBlock } from "./SubagentBlock.tsx";
import { QuestionCard } from "./QuestionCard.tsx";
import { ApprovalCard } from "./ApprovalCard.tsx";
import { CompletionBanner } from "./CompletionBanner.tsx";
import { ErrorBanner } from "./ErrorBanner.tsx";
import { CompactMarker } from "./CompactMarker.tsx";
import type { VizData } from "@/types/viz.ts";

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

interface ChatStreamProps {
  events: AgentEvent[];
  answeredRequests: Map<string, unknown>;
  onResolveRequest: (requestId: string, response: unknown) => void;
}

export function ChatStream({
  events,
  answeredRequests,
  onResolveRequest,
}: ChatStreamProps) {
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
  const activeSubagents = new Set<string>();
  for (const ev of events) {
    if (ev.eventType === "subagentStart")
      activeSubagents.add(ev.payload.agentId as string);
    if (ev.eventType === "subagentEnd")
      activeSubagents.delete(ev.payload.agentId as string);
  }

  // Pre-scan: track latest bonsai_visualize event per vizId for hybrid collapse.
  const latestVizByVizId = new Map<string, number>();
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    if (ev.eventType === "toolCallStart" && (ev.payload.toolName as string)?.endsWith("bonsai_visualize")) {
      const vizId = (ev.payload.toolInput as Record<string, unknown>)?.vizId as string | undefined;
      if (vizId) latestVizByVizId.set(vizId, i);
    }
  }

  // Pre-scan: group child events under their parent subagentStart.
  // Uses a stack to support nested subagents.
  const subagentChildren = new Map<number, number[]>(); // subagentStart idx → child idxs
  const childIndices = new Set<number>();               // events to skip in render
  {
    const stack: [number, string][] = []; // [(startIdx, agentId)]
    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      if (ev.eventType === "subagentStart") {
        stack.push([i, (ev.payload.agentId as string) ?? ""]);
        subagentChildren.set(i, []);
      } else if (ev.eventType === "subagentEnd") {
        const aid = (ev.payload.agentId as string) ?? "";
        for (let j = stack.length - 1; j >= 0; j--) {
          if (stack[j][1] === aid) { stack.splice(j, 1); break; }
        }
      } else if (stack.length > 0) {
        const [parentIdx] = stack[stack.length - 1];
        subagentChildren.get(parentIdx)!.push(i);
        childIndices.add(i);
      }
    }
  }

  return (
    <div className="chat-stream" ref={scrollRef} onScroll={handleScroll}>
      {events.map((ev, i) => {
        // Skip events that are children of a subagent (rendered inside SubagentBlock)
        if (childIndices.has(i)) return null;
        const p = ev.payload;
        const k = `${i}-${ev.eventType}`;
        switch (ev.eventType) {
          case "sessionStart":
            return (
              <SystemMessage
                key={k}
                text={`Session started \u2014 ${(p.model as string) ?? "agent"}`}
                variant="ok"
              />
            );

          case "userMessage":
            return (
              <div key={k} className="chat-user">
                <div className="chat-user-text">
                  {(p.text as string) ?? ""}
                </div>
              </div>
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
            // MCP tools may be prefixed with server name (e.g. mcp__bonsai-viz__bonsai_visualize)
            if ((p.toolName as string)?.endsWith("bonsai_visualize")) {
              const vizInput = p.toolInput as VizData | undefined;
              if (vizInput) {
                const vizId = vizInput.vizId;
                const isLatest = !vizId || latestVizByVizId.get(vizId) === i;
                return (
                  <VisualizationCard
                    key={k}
                    data={vizInput}
                    collapsed={!isLatest}
                  />
                );
              }
            }
            const toolUseId = (p.toolUseId as string) ?? "";
            const end = toolStates.get(toolUseId);
            return (
              <ToolCallCard
                key={k}
                toolName={(p.toolName as string) ?? "tool"}
                toolInput={extractToolInput(p.toolInput)}
                output={end?.output}
                isError={end?.isError}
                state={end?.finished ? (end.isError ? "error" : "success") : "running"}
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
            return (
              <QuestionCard
                key={k}
                questions={questions as never}
                answered={isAnswered}
                selectedAnswers={isAnswered ? (savedAnswer?.answers as Record<string, string>) : undefined}
                onSubmit={(response) => onResolveRequest(requestId, response)}
              />
            );
          }

          case "confirmAction": {
            const requestId = (p.requestId as string) ?? "";
            const isAnswered = answeredRequests.has(requestId);
            const savedResponse = answeredRequests.get(requestId) as Record<string, unknown> | undefined;
            const decision = savedResponse?.behavior === "allow" ? "approve" as const : "deny" as const;
            return (
              <ApprovalCard
                key={k}
                toolName={(p.toolName as string) ?? "action"}
                toolInput={p.toolInput ?? undefined}
                description={(p.description as string) ?? undefined}
                answered={isAnswered}
                decision={isAnswered ? decision : undefined}
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

          case "turnComplete": {
            const result = (p.result as string) ?? "";
            return (
              <>
                {result && (
                  <AssistantMessage
                    key={`${k}-result`}
                    text={result}
                    streaming={false}
                  />
                )}
                <SystemMessage
                  key={k}
                  text={`Turn complete \u2014 $${((p.costUsd as number) ?? 0).toFixed(2)} \u00B7 ${(p.turns as number) ?? 0} turns`}
                  variant="ok"
                />
              </>
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
                result={(p.result as string) ?? undefined}
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
}
