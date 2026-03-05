import { useCallback, useEffect, useRef } from "react";
import type { AgentEvent } from "@/types/agent.ts";
import { SystemMessage } from "./SystemMessage.tsx";
import { AssistantMessage } from "./AssistantMessage.tsx";
import { ToolCallCard } from "./ToolCallCard.tsx";
import { SubagentBlock } from "./SubagentBlock.tsx";
import { QuestionCard } from "./QuestionCard.tsx";
import { ApprovalCard } from "./ApprovalCard.tsx";
import { CompletionBanner } from "./CompletionBanner.tsx";
import { ErrorBanner } from "./ErrorBanner.tsx";
import { CompactMarker } from "./CompactMarker.tsx";

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

  // Build tool call state map (pair start/end by toolUseId)
  const toolStates = new Map<
    string,
    { output?: string; isError?: boolean; finished: boolean }
  >();
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

  // Track active subagents
  const activeSubagents = new Set<string>();
  for (const ev of events) {
    if (ev.eventType === "subagentStart")
      activeSubagents.add(ev.payload.agentId as string);
    if (ev.eventType === "subagentEnd")
      activeSubagents.delete(ev.payload.agentId as string);
  }

  return (
    <div className="chat-stream" ref={scrollRef} onScroll={handleScroll}>
      {events.map((ev, i) => {
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
            const toolUseId = (p.toolUseId as string) ?? "";
            const end = toolStates.get(toolUseId);
            const toolInput =
              typeof p.toolInput === "string"
                ? p.toolInput
                : typeof p.toolInput === "object" && p.toolInput
                  ? Object.values(p.toolInput as Record<string, unknown>)[0]?.toString() ?? ""
                  : "";
            return (
              <ToolCallCard
                key={k}
                toolName={(p.toolName as string) ?? "tool"}
                toolInput={toolInput}
                output={end?.output}
                isError={end?.isError}
                state={end?.finished ? (end.isError ? "error" : "success") : "running"}
              />
            );
          }

          case "toolCallEnd":
            return null; // Handled by toolCallStart pairing

          case "subagentStart":
            return (
              <SubagentBlock
                key={k}
                agentType={(p.agentType as string) ?? undefined}
                finished={!activeSubagents.has(p.agentId as string)}
              >
                {null}
              </SubagentBlock>
            );

          case "subagentEnd":
            return null; // Handled by subagentStart

          case "askUserQuestion": {
            const questions = (p.questions as AgentEvent["payload"][]) ?? [];
            const requestId = (p.requestId as string) ?? "";
            const isAnswered = answeredRequests.has(requestId);
            return (
              <QuestionCard
                key={k}
                questions={questions as never}
                answered={isAnswered}
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
