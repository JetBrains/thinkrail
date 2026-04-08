import { lazy, Suspense, useState } from "react";
import type { AgentEvent } from "@/types/agent.ts";
import { useSessionStore } from "@/store/sessionStore.ts";
import { SystemMessage } from "../SystemMessage.tsx";
import { AssistantMessage } from "../AssistantMessage.tsx";
import { ToolCallCard } from "../ToolCallCard.tsx";
import { DraftConfigCard } from "../DraftConfigCard.tsx";
import { VisualizationCard, VisErrorBoundary } from "../VisualizationCard.tsx";
import { SubagentBlock } from "../SubagentBlock.tsx";
import { TaskCard } from "../TaskCard.tsx";
import { QuestionCard } from "../QuestionCard.tsx";
import { ApprovalCard } from "../ApprovalCard.tsx";
import { PlanApprovalCard } from "../PlanApprovalCard.tsx";
import SuggestionCard from "../SuggestionCard.tsx";
import DescriptionSuggestionCard from "../DescriptionSuggestionCard.tsx";
import { CompletionBanner } from "../CompletionBanner.tsx";
import { ErrorBanner } from "../ErrorBanner.tsx";
import { CompactMarker } from "../CompactMarker.tsx";
import { ChatMarkdown } from "../ChatMarkdown.tsx";
import { extractToolInput } from "../ChatStream.tsx";
import type { VisData } from "@/types/vis.ts";
import type { ViewRenderers } from "./types.ts";

const DIFF_TOOLS = new Set(["Edit", "Write", "NotebookEdit"]);
const TASK_TOOLS = new Set(["TodoWrite", "TaskCreate", "TaskUpdate"]);
const DiffCard = lazy(() => import("../DiffCard.tsx").then(m => ({ default: m.DiffCard })));

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

export const classicRenderers: ViewRenderers = {
  sessionStart: (_ev, _i, k, ctx) => (
    <DraftConfigCard
      key={k}
      bonsaiSid={ctx.session!.bonsaiSid}
      readOnly
      onVisibilityChange={ctx.onContextCardVisibility}
    />
  ),

  userMessage: (ev, _i, k) => (
    <UserMessageBubble
      key={k}
      text={(ev.payload.text as string) ?? ""}
      isMarkdown={(ev.payload.isMarkdown as boolean) ?? false}
    />
  ),

  textDelta: (ev, _i, k) => (
    <AssistantMessage
      key={k}
      text={(ev.payload.text as string) ?? ""}
      streaming={(ev.payload.streaming as boolean) ?? false}
    />
  ),

  toolCallStart: (ev, i, k, ctx) => {
    const p = ev.payload;
    if ((p.toolName as string) === "AskUserQuestion") return null;

    if ((p.toolName as string)?.endsWith("bonsai_visualize")) {
      const visInput = p.toolInput as VisData | undefined;
      if (visInput && typeof visInput.data === "string") {
        try {
          visInput.data = JSON.parse(visInput.data);
        } catch {
          try {
            const repaired = (visInput.data as unknown as string).replace(/\\"/g, '\\\\"');
            visInput.data = JSON.parse(repaired);
          } catch {
            visInput.data = { _parseError: true } as any;
          }
        }
      }
      if (visInput) {
        const visId = visInput.visId;
        const isLatest = !visId || ctx.latestVisByVisId.get(visId) === i;
        return (
          <VisErrorBoundary key={k}>
            <VisualizationCard data={visInput} collapsed={!isLatest} />
          </VisErrorBoundary>
        );
      }
    }

    const toolName = (p.toolName as string) ?? "tool";
    const toolUseId = (p.toolUseId as string) ?? "";
    const end = ctx.toolStates.get(toolUseId);
    const state = end?.finished ? (end.isError ? "error" as const : "success" as const) : "running" as const;

    if (TASK_TOOLS.has(toolName)) {
      return (
        <TaskCard
          key={k}
          toolName={toolName}
          toolInput={(p.toolInput as Record<string, unknown>) ?? {}}
          state={state}
          isError={end?.isError}
        />
      );
    }

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
        rawInput={(p.toolInput as Record<string, unknown>) ?? {}}
        output={end?.output}
        isError={end?.isError}
        state={state}
      />
    );
  },

  toolCallEnd: () => null,

  subagentStart: (ev, i, k, ctx) => {
    const cEvents = (ctx.subagentChildren.get(i) ?? []).map(idx => ctx.events[idx]);
    return (
      <SubagentBlock
        key={k}
        agentType={(ev.payload.agentType as string) ?? undefined}
        finished={!ctx.activeSubagents.has(ev.payload.agentId as string)}
        childEvents={cEvents}
        toolStates={ctx.toolStates}
      />
    );
  },

  subagentEnd: () => null,

  askUserQuestion: (ev, _i, k, ctx) => {
    const questions = (ev.payload.questions as AgentEvent["payload"][]) ?? [];
    const requestId = (ev.payload.requestId as string) ?? "";
    const isAnswered = ctx.answeredRequests.has(requestId);
    const savedAnswer = ctx.answeredRequests.get(requestId) as Record<string, unknown> | undefined;
    const qInterrupted = savedAnswer?.interrupt === true;
    const qExpired = (savedAnswer as Record<string, unknown> | undefined)?.expired === true;
    return (
      <QuestionCard
        key={k}
        questions={questions as never}
        answered={isAnswered}
        interrupted={qInterrupted}
        expired={qExpired}
        selectedAnswers={isAnswered && !qExpired ? (savedAnswer?.answers as Record<string, string>) : undefined}
        onSubmit={(response) => ctx.onResolveRequest(requestId, response)}
        requestId={requestId}
      />
    );
  },

  confirmAction: (ev, _i, k, ctx) => {
    const p = ev.payload;
    const requestId = (p.requestId as string) ?? "";
    const isAnswered = ctx.answeredRequests.has(requestId);
    const savedResponse = ctx.answeredRequests.get(requestId) as Record<string, unknown> | undefined;
    const aInterrupted = savedResponse?.interrupt === true;
    const aExpired = (savedResponse as Record<string, unknown> | undefined)?.expired === true;
    const decision = aExpired
      ? "deny" as const
      : savedResponse?.behavior === "allow" ? "approve" as const : "deny" as const;

    if ((p.toolName as string) === "ExitPlanMode") {
      const toolInput = p.toolInput as Record<string, unknown> | undefined;
      return (
        <PlanApprovalCard
          key={k}
          planContent={(toolInput?.plan as string) ?? undefined}
          allowedPrompts={(toolInput?.allowedPrompts as Array<{ tool: "Bash"; prompt: string }>) ?? undefined}
          answered={isAnswered}
          decision={isAnswered ? decision : undefined}
          interrupted={aInterrupted || aExpired}
          onApprove={() => ctx.onResolveRequest(requestId, { behavior: "allow" })}
          rejectionReason={
            aExpired
              ? "timed out"
              : isAnswered && decision === "deny" && !aInterrupted
                ? (savedResponse?.rejectionReason as string) ?? undefined
                : undefined
          }
          onDeny={(reason?: string) => {
            ctx.onResolveRequest(requestId, {
              behavior: "deny",
              message: reason ? `Plan rejected: ${reason}` : "Plan rejected",
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
        interrupted={aInterrupted || aExpired}
        onApprove={() => ctx.onResolveRequest(requestId, { behavior: "allow" })}
        onDeny={() =>
          ctx.onResolveRequest(requestId, {
            behavior: "deny",
            message: "User denied",
            interrupt: false,
          })
        }
      />
    );
  },

  suggestSession: (ev, _i, k, ctx) => {
    const p = ev.payload;
    const requestId = (p.requestId as string) ?? "";
    const isAnswered = ctx.answeredRequests.has(requestId);
    const savedResponse = ctx.answeredRequests.get(requestId) as Record<string, unknown> | undefined;
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
          ctx.onResolveRequest(requestId, { behavior: "allow" });
          const store = useSessionStore.getState();
          const currentSession = ctx.session;
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
          ctx.onResolveRequest(requestId, {
            behavior: "deny",
            message: reason ? `Dismissed: ${reason}` : "Dismissed",
            dismissReason: reason ?? "",
          })
        }
      />
    );
  },

  suggestDescription: (ev, _i, k, ctx) => {
    const p = ev.payload;
    const requestId = (p.requestId as string) ?? "";
    const isAnswered = ctx.answeredRequests.has(requestId);
    const savedResponse = ctx.answeredRequests.get(requestId) as Record<string, unknown> | undefined;
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
          ctx.onResolveRequest(requestId, { behavior: "allow" });
          ctx.onApplyDescription?.(descText);
        }}
        onDismiss={(reason) =>
          ctx.onResolveRequest(requestId, {
            behavior: "deny",
            message: reason ? `Dismissed: ${reason}` : "Dismissed",
            dismissReason: reason ?? "",
          })
        }
      />
    );
  },

  turnComplete: (ev, _i, k) => (
    <SystemMessage
      key={k}
      text={`Turn complete \u2014 $${((ev.payload.turnCostUsd as number) ?? 0).toFixed(2)} \u00B7 ${(ev.payload.turn_turns as number) ?? 0} turns`}
      variant="ok"
    />
  ),

  interrupted: (_ev, _i, k) => <SystemMessage key={k} text="Turn interrupted" />,

  done: (ev, _i, k) => (
    <CompletionBanner
      key={k}
      costUsd={(ev.payload.costUsd as number) ?? undefined}
      turns={(ev.payload.turns as number) ?? undefined}
      durationMs={(ev.payload.durationMs as number) ?? undefined}
    />
  ),

  error: (ev, _i, k) => (
    <ErrorBanner
      key={k}
      subtype={(ev.payload.subtype as string) ?? undefined}
      errors={(ev.payload.errors as string[]) ?? undefined}
    />
  ),

  notification: (ev, _i, k) => (
    <SystemMessage key={k} text={(ev.payload.message as string) ?? ""} />
  ),

  compact: (ev, _i, k) => (
    <CompactMarker
      key={k}
      preTokens={(ev.payload.preTokens as number) ?? undefined}
    />
  ),

  permissionDenied: (ev, _i, k) => (
    <div key={k} className="chat-banner chat-banner-warn">
      Permission denied: {(ev.payload.toolName as string) ?? "action"}
    </div>
  ),

  requestResolved: () => null,
  requestExpired: () => null,
};
