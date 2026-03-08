import { useState, useEffect, useRef } from "react";
import type { AgentEvent } from "@/types/agent.ts";
import { ToolCallCard } from "./ToolCallCard.tsx";
import { extractToolInput, type ToolState } from "./ChatStream.tsx";

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
  const [expanded, setExpanded] = useState(!finished);
  const wasFinished = useRef(finished);

  // Auto-collapse when subagent finishes
  useEffect(() => {
    if (finished && !wasFinished.current) {
      setExpanded(false);
    }
    wasFinished.current = finished;
  }, [finished]);

  const summary = buildSummary(childEvents);

  return (
    <div className="chat-subagent">
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
              const toolUseId = (ev.payload.toolUseId as string) ?? "";
              const end = toolStates.get(toolUseId);
              return (
                <ToolCallCard
                  key={`subagent-tool-${ci}`}
                  toolName={toolName}
                  toolInput={extractToolInput(ev.payload.toolInput)}
                  output={end?.output}
                  isError={end?.isError}
                  state={
                    end?.finished
                      ? end.isError
                        ? "error"
                        : "success"
                      : "running"
                  }
                  compact
                />
              );
            }
            if (ev.eventType === "textDelta") {
              return (
                <div key={`subagent-text-${ci}`} className="chat-subagent-text">
                  {(ev.payload.text as string) ?? ""}
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
