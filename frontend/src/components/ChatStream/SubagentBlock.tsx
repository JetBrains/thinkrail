import { lazy, Suspense, useState, useCallback } from "react";
import { useExpandCollapse } from "./useExpandCollapse.ts";
import type { AgentEvent } from "@/types/agent.ts";
import type { VisData } from "@/types/vis.ts";
import { ChatMarkdown } from "./ChatMarkdown.tsx";
import { ToolCallCard } from "./ToolCallCard.tsx";
import { VisualizationCard, VisErrorBoundary } from "./VisualizationCard.tsx";
import { extractToolInput, type ToolState } from "./ChatStream.tsx";

const DIFF_TOOLS = new Set(["Edit", "Write", "NotebookEdit"]);
const DiffCard = lazy(() => import("./DiffCard.tsx").then(m => ({ default: m.DiffCard })));

interface SubagentBlockProps {
  agentType?: string;
  finished: boolean;
  childEvents: AgentEvent[];
  toolStates: Map<string, ToolState>;
}

/** Build a summary like "8 tool calls (3 Read, 2 Edit, 2 Bash, 1 Grep)" */
function buildSummary(childEvents: AgentEvent[]): string {
  const toolCounts = new Map<string, number>();
  for (const ev of childEvents) {
    if (ev.eventType === "toolCallStart") {
      const name = (ev.payload.toolName as string) ?? "tool";
      toolCounts.set(name, (toolCounts.get(name) ?? 0) + 1);
    }
  }
  const total = Array.from(toolCounts.values()).reduce((a, b) => a + b, 0);
  if (total === 0) return "No tool calls";
  const breakdown = Array.from(toolCounts.entries())
    .sort(([, a], [, b]) => b - a)
    .map(([name, count]) => `${count} ${name}`)
    .join(", ");
  return `${total} tool call${total !== 1 ? "s" : ""} (${breakdown})`;
}

export function SubagentBlock({
  agentType,
  finished,
  childEvents,
  toolStates,
}: SubagentBlockProps) {
  const [expanded, setExpanded] = useState(false);
  const expandRef = useExpandCollapse(useCallback((v: boolean) => setExpanded(v), []));

  const summary = buildSummary(childEvents);

  return (
    <div ref={expandRef} className="chat-subagent">
      <div
        className="chat-subagent-header chat-subagent-header--clickable"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="chat-subagent-toggle">
          {expanded ? "\u25BC" : "\u25B6"}
        </span>
        <span>{finished ? "\u2713" : "\u26A1"}</span>
        <span>Subagent: {agentType ?? "agent"}</span>
        {!finished && <span className="chat-spinner" />}
        {!expanded && (
          <span className="chat-subagent-summary">{summary}</span>
        )}
      </div>
      {expanded && (
        <div className="chat-subagent-body">
          {childEvents.map((ev, ci) => {
            if (ev.eventType === "toolCallStart") {
              const toolName = (ev.payload.toolName as string) ?? "tool";
              if (toolName === "AskUserQuestion") return null;
              if (toolName === "TaskGet" || toolName === "TaskList") return null;
              // Render thinkrail_visualize as VisualizationCard (mirrors ChatStream.tsx)
              if (toolName.endsWith("thinkrail_visualize")) {
                const visInput = ev.payload.toolInput as VisData | undefined;
                if (visInput) {
                  return (
                    <VisErrorBoundary key={`subagent-vis-${ci}`}>
                      <VisualizationCard data={visInput} />
                    </VisErrorBoundary>
                  );
                }
              }
              const toolUseId = (ev.payload.toolUseId as string) ?? "";
              const end = toolStates.get(toolUseId);
              const state = end?.finished ? (end.isError ? "error" as const : "success" as const) : "running" as const;
              if (DIFF_TOOLS.has(toolName)) {
                return (
                  <Suspense key={`subagent-diff-${ci}`} fallback={<ToolCallCard toolName={toolName} toolInput={extractToolInput(ev.payload.toolInput)} state="running" compact />}>
                    <DiffCard
                      toolName={toolName}
                      toolInput={(ev.payload.toolInput as Record<string, unknown>) ?? {}}
                      output={end?.output}
                      isError={end?.isError}
                      state={state}
                      compact
                    />
                  </Suspense>
                );
              }
              return (
                <ToolCallCard
                  key={`subagent-tool-${ci}`}
                  toolName={toolName}
                  rawInput={(ev.payload.toolInput as Record<string, unknown>) ?? {}}
                  output={end?.output}
                  isError={end?.isError}
                  state={state}
                  compact
                />
              );
            }
            if (ev.eventType === "textDelta") {
              return (
                <div key={`subagent-text-${ci}`} className="chat-subagent-text">
                  <ChatMarkdown content={(ev.payload.text as string) ?? ""} />
                </div>
              );
            }
            return null;
          })}
        </div>
      )}
    </div>
  );
}
