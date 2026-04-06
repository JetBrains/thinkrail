import { useState, useEffect } from "react";
import { extractToolHeader, cleanToolName } from "./toolHeaderExtractors.ts";
import { ToolInputDetail } from "./ToolInputDetail.tsx";
import { ToolOutputBody } from "./ToolOutputBody.tsx";

const TOOL_ICONS: Record<string, string> = {
  Read: "\u{1F4D6}",
  Write: "\u270F\uFE0F",
  Edit: "\u270F\uFE0F",
  Bash: "\u25B6",
  Grep: "\u{1F50D}",
  Glob: "\u{1F4C2}",
  Agent: "\u26A1",
  WebSearch: "\u{1F310}",
  WebFetch: "\u{1F310}",
  NotebookEdit: "\u{1F4D3}",
  TodoWrite: "\u2611",
  TaskCreate: "\u2611",
  TaskUpdate: "\u2611",
};

function getToolIcon(name: string): string {
  return TOOL_ICONS[name] ?? "\u{1F527}";
}

type CardState = "running" | "success" | "error";

interface ToolCallCardProps {
  toolName: string;
  rawInput?: Record<string, unknown>;
  toolInput?: string;
  output?: string;
  isError?: boolean;
  state: CardState;
  compact?: boolean;
}

export function ToolCallCard({
  toolName,
  rawInput,
  toolInput,
  output,
  isError,
  state,
  compact = false,
}: ToolCallCardProps) {
  const [expanded, setExpanded] = useState(false);

  // Auto-expand when a tool call transitions to error state (live sessions)
  useEffect(() => {
    if (isError && state === "error") setExpanded(true);
  }, [isError, state]);

  const borderColor =
    state === "running"
      ? "var(--blue)"
      : isError
        ? "var(--red)"
        : "var(--green)";

  const statusIcon =
    state === "running" ? "\u25CF" : isError ? "\u2715" : "\u2713";

  // Clean MCP tool name prefix for display (keep raw for icon lookup)
  const displayName = cleanToolName(toolName);

  // Smart header extraction from raw input, or fall back to legacy string
  const header = rawInput
    ? extractToolHeader(displayName, rawInput, output, isError)
    : null;
  const summaryText = header?.summary ?? toolInput ?? "";

  return (
    <div className={`chat-tool${compact ? " chat-tool--compact" : ""}`} style={{ borderLeftColor: borderColor }}>
      <div
        className="chat-tool-header"
        onClick={() => state !== "running" && setExpanded(!expanded)}
      >
        <span className="chat-tool-icon">{getToolIcon(toolName)}</span>
        <span className="chat-tool-name">{displayName}</span>
        {summaryText && (
          <span className="chat-tool-input">{summaryText}</span>
        )}
        {header?.badge && (
          <span className="chat-tool-badge">{header.badge}</span>
        )}
        <span className="chat-tool-status" style={{ color: borderColor }}>
          {statusIcon} {state === "running" ? "running..." : isError ? "error" : "done"}
        </span>
      </div>
      {expanded && (
        <div className="chat-tool-body">
          {rawInput && Object.keys(rawInput).filter(k => !k.startsWith("_")).length > 1 && (
            <ToolInputDetail input={rawInput} />
          )}
          {output && (
            <ToolOutputBody output={output} isError={isError} />
          )}
          {!rawInput && !output && toolInput && (
            <pre>{toolInput}</pre>
          )}
        </div>
      )}
    </div>
  );
}
