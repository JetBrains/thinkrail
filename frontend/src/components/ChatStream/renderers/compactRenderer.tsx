import { lazy, Suspense } from "react";
import { isWizardSkill } from "@/components/Wizard/registry.ts";
import { CardState } from "@/constants/status.ts";
import { AssistantMessage, ThinkRailMessage } from "../AssistantMessage.tsx";
import { ToolCallCard } from "../ToolCallCard.tsx";
import { DraftConfigCard } from "../DraftConfigCard.tsx";
import { VisualizationCard, VisErrorBoundary } from "../VisualizationCard.tsx";
import { TaskCard } from "../TaskCard.tsx";
import { QuestionCard } from "../QuestionCard.tsx";
import { ApprovalCard } from "../ApprovalCard.tsx";
import { PlanApprovalCard } from "../PlanApprovalCard.tsx";
import { CompactToolLine } from "../CompactToolLine.tsx";
import { CompactUserMessage } from "../CompactUserMessage.tsx";
import { CompactSubagent } from "../CompactSubagent.tsx";
import { extractToolInput } from "../ChatStream.tsx";
import type { VisData } from "@/types/vis.ts";
import type { ViewRenderers } from "./types.ts";

const DIFF_TOOLS = new Set(["Edit", "Write", "NotebookEdit"]);
const TASK_TOOLS = new Set(["TodoWrite", "TaskCreate", "TaskUpdate"]);
const DiffCard = lazy(() => import("../DiffCard.tsx").then(m => ({ default: m.DiffCard })));

/**
 * Compact renderers — overrides for events that render differently in compact mode.
 * Unspecified event types fall back to classicRenderers via the registry.
 */
export const compactRenderers: ViewRenderers = {
  sessionStart: (_ev, _i, k, ctx) => (
    <DraftConfigCard
      key={k}
      thinkrailSid={ctx.session!.thinkrailSid}
      readOnly
      onVisibilityChange={ctx.onContextCardVisibility}
    />
  ),

  userMessage: (ev, _i, k) => (
    <CompactUserMessage
      key={k}
      text={ev.payload.text}
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

    // Visualizations: collapsible in compact mode
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
        // See classicRenderer: the host WizardStepper owns onboarding-chain
        // progress; drop an agent-emitted `workflow-progress` tracker inside
        // a wizard session so it can't render a competing, drifting copy.
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
              <VisualizationCard data={visInput} collapsed={!isLatest} compactMode />
            </VisErrorBoundary>
          </ThinkRailMessage>
        );
      }
    }

    const toolName = p.toolName;
    const toolUseId = p.toolUseId;
    const end = ctx.toolStates.get(toolUseId);
    const state = end?.finished ? (end.isError ? CardState.Error : CardState.Success) : CardState.Running;

    // Task tools render the same in both modes
    if (TASK_TOOLS.has(toolName)) {
      const isTaskFamily = toolName === "TaskCreate" || toolName === "TaskUpdate";
      if (isTaskFamily) {
        if (ctx.taskCollectionAnchor !== i) return null;
        return (
          <div key={k} data-task-card-anchor>
            <TaskCard
              toolName={toolName}
              toolInput={p.toolInput}
              state={state}
              isError={end?.isError}
              tasks={ctx.taskCollection}
            />
          </div>
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

    // Diff tools: use compact ToolCallCard as fallback while loading
    if (DIFF_TOOLS.has(toolName)) {
      return (
        <Suspense key={k} fallback={<ToolCallCard toolName={toolName} toolInput={extractToolInput(p.toolInput)} state="running" compact />}>
          <DiffCard
            toolName={toolName}
            toolInput={p.toolInput}
            output={end?.output}
            isError={end?.isError}
            state={state}
            compact
          />
        </Suspense>
      );
    }

    // Compact log-line for all other tools
    const approval = ctx.approvalByToolIndex.get(i);
    return (
      <CompactToolLine
        key={k}
        toolName={toolName}
        rawInput={p.toolInput}
        output={end?.output}
        isError={end?.isError}
        state={state}
        approval={approval}
        onResolveRequest={approval ? ctx.onResolveRequest : undefined}
      />
    );
  },

  toolCallEnd: () => null,

  subagentStart: (ev, i, k, ctx) => {
    const cEvents = (ctx.subagentChildren.get(i) ?? []).map(idx => ctx.events[idx]);
    return (
      <CompactSubagent
        key={k}
        agentType={ev.payload.agentType}
        finished={!ctx.activeSubagents.has(ev.payload.agentId)}
        childEvents={cEvents}
        toolStates={ctx.toolStates}
      />
    );
  },

  subagentEnd: () => null,

  // In compact mode, confirmAction events that are linked to a tool call
  // are suppressed (rendered as badge on the tool's CompactToolLine).
  // Only unlinked confirmAction events (ExitPlanMode, or orphaned) render standalone.
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

    // ExitPlanMode always gets its own card
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

    // Check if this approval was linked to a tool call in the pre-scan.
    // If so, it's rendered as a badge on CompactToolLine — skip standalone card.
    // We detect this by checking if any approvalByToolIndex entry has this requestId.
    for (const approval of ctx.approvalByToolIndex.values()) {
      if (approval.requestId === requestId) return null;
    }

    // Unlinked approval — render standalone card (same as classic)
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

  // Compact answered question → log line; pending → same card as classic
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
        hideDiscuss={isWizardSkill(ctx.session?.skillId)}
        compact
      />
    );
  },

  // suggestSession and suggestDescription fall back to classic (shared)

  requestResolved: () => null,
  requestExpired: () => null,
};
