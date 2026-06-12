import { useState } from "react";
import type { AgentEvent } from "@/types/agent.ts";
import { ChatMarkdown } from "./ChatMarkdown.tsx";
import { CompactToolLine } from "./CompactToolLine.tsx";
import type { ToolState } from "./ChatStream.tsx";

interface CompactSubagentProps {
  agentType?: string;
  finished: boolean;
  childEvents: AgentEvent[];
  toolStates: Map<string, ToolState>;
}

function countTools(childEvents: AgentEvent[]): number {
  return childEvents.filter((ev) => ev.eventType === "toolCallStart").length;
}

export function CompactSubagent({
  agentType,
  finished,
  childEvents,
  toolStates,
}: CompactSubagentProps) {
  const [expanded, setExpanded] = useState(false);

  const toolCount = countTools(childEvents);
  const statusText = finished ? "done" : "running...";

  return (
    <div className="compact-subagent">
      <div
        className="compact-subagent-header"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="compact-subagent-toggle">
          {expanded ? "\u25BE" : "\u25B8"}
        </span>
        <span className="compact-log-icon">{"\u26A1"}</span>
        <span className="compact-subagent-name">Agent</span>
        <span className="compact-subagent-detail">
          {"\u2014"} {agentType ?? "agent"} {"\u00B7"} {toolCount} tool{toolCount !== 1 ? "s" : ""} {"\u00B7"} {statusText}
        </span>
        {!finished && <span className="chat-spinner" />}
      </div>
      {expanded && (
        <div className="compact-subagent-body">
          {childEvents.map((ev, ci) => {
            if (ev.eventType === "toolCallStart") {
              const toolName = (ev.payload.toolName as string) ?? "tool";
              if (toolName === "AskUserQuestion") return null;
              if (toolName.endsWith("thinkrail_visualize")) return null;
              const toolUseId = (ev.payload.toolUseId as string) ?? "";
              const end = toolStates.get(toolUseId);
              const state = end?.finished
                ? (end.isError ? "error" as const : "success" as const)
                : "running" as const;
              return (
                <CompactToolLine
                  key={`csub-tool-${ci}`}
                  toolName={toolName}
                  rawInput={(ev.payload.toolInput as Record<string, unknown>) ?? {}}
                  output={end?.output}
                  isError={end?.isError}
                  state={state}
                />
              );
            }
            if (ev.eventType === "textDelta") {
              return (
                <div key={`csub-text-${ci}`} className="compact-subagent-text">
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
