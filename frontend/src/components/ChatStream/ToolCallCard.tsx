import { useState } from "react";

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
};

function getToolIcon(name: string): string {
  return TOOL_ICONS[name] ?? "\u{1F527}";
}

type CardState = "running" | "success" | "error";

interface ToolCallCardProps {
  toolName: string;
  toolInput?: string;
  output?: string;
  isError?: boolean;
  state: CardState;
  compact?: boolean;
}

export function ToolCallCard({
  toolName,
  toolInput,
  output,
  isError,
  state,
  compact = false,
}: ToolCallCardProps) {
  const [expanded, setExpanded] = useState(false);

  const borderColor =
    state === "running"
      ? "var(--blue)"
      : isError
        ? "var(--red)"
        : "var(--green)";

  const statusText =
    state === "running"
      ? "running..."
      : isError
        ? "error"
        : "done";

  const statusIcon =
    state === "running" ? "\u25CF" : isError ? "\u2715" : "\u2713";

  return (
    <div className={`chat-tool${compact ? " chat-tool--compact" : ""}`} style={{ borderLeftColor: borderColor }}>
      <div
        className="chat-tool-header"
        onClick={() => state !== "running" && setExpanded(!expanded)}
      >
        <span className="chat-tool-icon">{getToolIcon(toolName)}</span>
        <span className="chat-tool-name">{toolName}</span>
        {toolInput && (
          <span className="chat-tool-input">{toolInput}</span>
        )}
        <span className="chat-tool-status" style={{ color: borderColor }}>
          {statusIcon} {statusText}
        </span>
      </div>
      {expanded && output && (
        <div className="chat-tool-body">
          <pre>{output}</pre>
        </div>
      )}
    </div>
  );
}
