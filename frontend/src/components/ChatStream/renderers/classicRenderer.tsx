import { lazy, Suspense, useState } from "react";
import { useSessionStore } from "@/store/sessionStore.ts";
import { isWizardSkill } from "@/components/Wizard/registry.ts";
import { SystemMessage } from "../SystemMessage.tsx";
import { AssistantMessage, ThinkRailMessage } from "../AssistantMessage.tsx";
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
import StepProposalCard from "../StepProposalCard.tsx";
import { CompletionBanner } from "../CompletionBanner.tsx";
import { ErrorBanner } from "../ErrorBanner.tsx";
import { CompactMarker } from "../CompactMarker.tsx";
import { SubsessionResultCard } from "../SubsessionResultCard.tsx";
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

  return (
    <div className="chat-user">
      <div className="msg-content">
        <div className="msg-who">You</div>
        <div className="msg-bubble msg-bubble-user">
          {!isMarkdown || showRaw ? (
            <div className="chat-user-text">{text}</div>
          ) : (
            <div className="chat-user-text--md">
              <ChatMarkdown content={text} />
            </div>
          )}
          {isMarkdown && (
            <button
              className="chat-user-toggle"
              onClick={() => setShowRaw((v) => !v)}
              title={showRaw ? "Show rendered" : "Show raw"}
            >
              {showRaw ? "md" : "raw"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export const classicRenderers: ViewRenderers = {
  sessionStart: (_ev, _i, k, ctx) => (
    <DraftConfigCard
      key={k}
      thinkrailSid={ctx.session!.thinkrailSid}
      readOnly
      onVisibilityChange={ctx.onContextCardVisibility}
    />
  ),

  userMessage: (ev, _i, k) => (
    <UserMessageBubble
      key={k}
      text={ev.payload.text}
      isMarkdown={ev.payload.isMarkdown ?? false}
    />
  ),

  textDelta: (ev, _i, k) => (
    <AssistantMessage
      key={k}
      text={ev.payload.text}
      streaming={false}
    />
  ),

  toolCallStart: (ev, i, k, ctx) => {
    const p = ev.payload;
    if (p.toolName === "AskUserQuestion") return null;
    if (p.toolName === "TaskGet" || p.toolName === "TaskList") return null;

    if (p.toolName.endsWith("thinkrail_visualize")) {
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
        // The host WizardStepper is the single source for onboarding-chain
        // progress (Wizard/registry.ts). Suppress an agent-emitted
        // `workflow-progress` tracker inside a wizard session so it can't
        // render a second, drifting copy. Standalone runs still show it.
        if (
          visInput.type === "progress-tracker" &&
          visInput.visId === "workflow-progress" &&
          isWizardSkill(ctx.session?.skillId)
        ) {
          return null;
        }
        const visId = visInput.visId;
        const isLatest = !visId || ctx.latestVisByVisId.get(visId) === i;
        return (
          <ThinkRailMessage key={k} contentClassName="msg-content--vis">
            <VisErrorBoundary>
              <VisualizationCard data={visInput} collapsed={!isLatest} />
            </VisErrorBoundary>
          </ThinkRailMessage>
        );
      }
    }

    const toolName = p.toolName;
    const toolUseId = p.toolUseId;
    const end = ctx.toolStates.get(toolUseId);
    const state = end?.finished ? (end.isError ? "error" as const : "success" as const) : "running" as const;

    if (TASK_TOOLS.has(toolName)) {
      const isTaskFamily = toolName === "TaskCreate" || toolName === "TaskUpdate";
      if (isTaskFamily) {
        if (ctx.taskCollectionAnchor !== i) return null;
        return (
          <TaskCard
            key={k}
            toolName={toolName}
            toolInput={p.toolInput}
            state={state}
            isError={end?.isError}
            tasks={ctx.taskCollection}
          />
        );
      }
      return (
        <TaskCard
          key={k}
          toolName={toolName}
          toolInput={p.toolInput}
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
            toolInput={p.toolInput}
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
        rawInput={p.toolInput}
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
        agentType={ev.payload.agentType}
        finished={!ctx.activeSubagents.has(ev.payload.agentId)}
        childEvents={cEvents}
        toolStates={ctx.toolStates}
      />
    );
  },

  subagentEnd: () => null,

  askUserQuestion: (ev, _i, k, ctx) => {
    const questions = ev.payload.questions;
    const requestId = ev.payload.requestId ?? "";
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
    const requestId = p.requestId ?? "";
    const isAnswered = ctx.answeredRequests.has(requestId);
    const savedResponse = ctx.answeredRequests.get(requestId) as Record<string, unknown> | undefined;
    const aInterrupted = savedResponse?.interrupt === true;
    const aExpired = (savedResponse as Record<string, unknown> | undefined)?.expired === true;
    const decision = aExpired
      ? "deny" as const
      : savedResponse?.behavior === "allow" ? "approve" as const : "deny" as const;

    if (p.toolName === "ExitPlanMode") {
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
        toolName={p.toolName}
        toolInput={p.toolInput ?? undefined}
        description={p.description ?? undefined}
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
    const requestId = p.requestId ?? "";
    const isAnswered = ctx.answeredRequests.has(requestId);
    const savedResponse = ctx.answeredRequests.get(requestId) as Record<string, unknown> | undefined;
    const decision = savedResponse?.behavior === "allow" ? "approved" as const : "dismissed" as const;

    return (
      <SuggestionCard
        key={k}
        skill={p.skill ?? ""}
        specIds={p.specIds ?? []}
        name={p.name ?? ""}
        reason={p.reason ?? ""}
        prompt={p.prompt ?? undefined}
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
          // Carry the ticket link from the payload (auto-filled by the
          // SuggestSession tool from the parent task's ticket_id);
          // fall back to the current session's link if missing.
          const ticketId = p.ticketId ?? currentSession?.ticketId ?? undefined;
          try {
            const newSid = await store.startSession({
              skillId: p.skill ?? undefined,
              specIds: p.specIds ?? [],
              prompt: p.prompt ?? undefined,
              name: p.name ?? "Suggested Session",
              ticketId,
              config: {
                model: currentSession?.model ?? "sonnet",
                permissionMode: currentSession?.permissionMode ?? "default",
                streamText: true,
                effort: currentSession?.effort ?? "auto",
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
    const requestId = p.requestId ?? "";
    const isAnswered = ctx.answeredRequests.has(requestId);
    const savedResponse = ctx.answeredRequests.get(requestId) as Record<string, unknown> | undefined;
    const decision = savedResponse?.behavior === "allow" ? "applied" as const : "dismissed" as const;
    const descText = p.description;

    return (
      <DescriptionSuggestionCard
        key={k}
        description={descText}
        section={p.section || undefined}
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

  suggestStep: (ev, _i, k, ctx) => {
    const p = ev.payload;
    const requestId = p.requestId ?? "";
    const isAnswered = ctx.answeredRequests.has(requestId);
    const savedResponse = ctx.answeredRequests.get(requestId) as Record<string, unknown> | undefined;
    const decision = savedResponse?.behavior === "allow" ? "approved" as const : "dismissed" as const;

    return (
      <StepProposalCard
        key={k}
        ticketId={p.ticketId ?? ""}
        stepNumber={p.stepNumber ?? 0}
        stepTitle={p.stepTitle ?? ""}
        skill={p.skill ?? ""}
        inputSpecIds={p.inputSpecIds ?? []}
        reason={p.reason ?? ""}
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
          // The plan model uses `skill: "default"` as the sentinel for
          // "no specific skill" — pass undefined so the backend doesn't try
          // to load a skills/default/SKILL.md that never exists.
          const skillId = p.skill && p.skill !== "default" ? p.skill : undefined;
          try {
            const newSid = await store.startSession({
              skillId,
              specIds: p.inputSpecIds ?? [],
              name: `Step ${p.stepNumber ?? "?"}: ${p.stepTitle ?? ""}`.trim(),
              ticketId: p.ticketId ?? undefined,
              config: {
                model: currentSession?.model ?? "sonnet",
                permissionMode: currentSession?.permissionMode ?? "default",
                streamText: true,
                effort: currentSession?.effort ?? "auto",
              },
            });
            // Intentionally do NOT switchSession: in ticket-route the
            // orchestrator chat stays on screen so step events stream back
            // into it. startSession leaves the runtime idle, so kick the new
            // session off by sending the step's instructions as the first
            // message — otherwise it sits idle forever.
            if (p.agentInstructions) {
              await store.sendMessage(newSid, p.agentInstructions);
            }
          } catch (err) {
            console.error("[StepProposalCard] Failed to start step session:", err);
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

  turnComplete: (ev, _i, k) => (
    <SystemMessage
      key={k}
      text={`Turn complete \u2014 $${(ev.payload.turnCostUsd ?? 0).toFixed(2)} \u00B7 ${ev.payload.turns ?? 0} turns`}
      variant="ok"
    />
  ),

  interrupted: (_ev, _i, k) => <SystemMessage key={k} text="Turn interrupted" />,

  done: (ev, _i, k) => (
    <CompletionBanner
      key={k}
      costUsd={ev.payload.costUsd}
      turns={ev.payload.turns}
      durationMs={ev.payload.durationMs}
    />
  ),

  error: (ev, _i, k, ctx) => (
    <ErrorBanner
      key={k}
      subtype={ev.payload.subtype}
      errors={ev.payload.errors}
      thinkrailSid={ctx.session?.thinkrailSid}
    />
  ),

  notification: (ev, _i, k) => {
    const p = ev.payload;
    if (p.type === "subsessionResult") {
      return (
        <SubsessionResultCard
          key={k}
          childName={p.childName as string}
          summary={p.summary as string}
        />
      );
    }
    return <SystemMessage key={k} text={p.message ?? ""} />;
  },

  compact: (ev, _i, k) => (
    <CompactMarker
      key={k}
      preTokens={ev.payload.preTokens}
    />
  ),

  permissionDenied: (ev, _i, k) => (
    <div key={k} className="chat-banner chat-banner-warn">
      Permission denied: {ev.payload.toolName ?? "action"}
    </div>
  ),

  proposeChange: () => null,

  setPreviewFile: () => null,
  clearPreviewFile: () => null,
  requestResolved: () => null,
  requestExpired: () => null,
};
