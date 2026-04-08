import { useState, useEffect, useCallback } from "react";
import { extractToolHeader, cleanToolName } from "./toolHeaderExtractors.ts";
import { ToolInputDetail } from "./ToolInputDetail.tsx";
import { ToolOutputBody } from "./ToolOutputBody.tsx";
import { useExpandCollapse } from "./useExpandCollapse.ts";
import type { ApprovalInfo } from "./renderers/types.ts";

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

interface CompactToolLineProps {
  toolName: string;
  rawInput?: Record<string, unknown>;
  output?: string;
  isError?: boolean;
  state: CardState;
  approval?: ApprovalInfo;
  onResolveRequest?: (requestId: string, response: unknown) => void;
}

export function CompactToolLine({
  toolName,
  rawInput,
  output,
  isError,
  state,
  approval,
  onResolveRequest,
}: CompactToolLineProps) {
  const [expanded, setExpanded] = useState(false);
  const expandRef = useExpandCollapse(useCallback((v: boolean) => {
    if (state !== "running") setExpanded(v);
  }, [state]));

  useEffect(() => {
    if (isError && state === "error") setExpanded(true);
  }, [isError, state]);

  const displayName = cleanToolName(toolName);
  const header = rawInput
    ? extractToolHeader(displayName, rawInput, output, isError)
    : null;
  const summaryText = header?.summary ?? "";

  const borderColor =
    state === "running"
      ? "var(--blue)"
      : isError
        ? "var(--red)"
        : "var(--green)";

  const statusIcon = state === "running" ? "\u25CF" : isError ? "\u2715" : "\u2713";

  // Pending approval: show inline approve/deny buttons
  const showPendingApproval = approval && !approval.answered && !approval.interrupted;

  return (
    <div ref={expandRef} className="compact-log-wrap">
      <div
        className="compact-log"
        style={{ borderLeftColor: borderColor }}
        onClick={() => state !== "running" && setExpanded(!expanded)}
      >
        <span className="compact-log-icon">{getToolIcon(toolName)}</span>
        <span className="compact-log-name">{displayName}</span>
        {summaryText && (
          <span className="compact-log-detail">{summaryText}</span>
        )}
        {header?.badge && (
          <span className="compact-log-badge-info">{header.badge}</span>
        )}
        {/* Inline approval badge (answered) */}
        {approval?.answered && (
          <span
            className={`compact-approval-badge ${
              approval.decision === "approve"
                ? "compact-approval-badge--approved"
                : "compact-approval-badge--denied"
            }`}
          >
            {approval.decision === "approve" ? "\u2713 approved" : "\u2715 denied"}
          </span>
        )}
        {/* Inline approval buttons (pending) */}
        {showPendingApproval && (
          <span className="compact-approval-pending" onClick={(e) => e.stopPropagation()}>
            <button
              className="compact-btn compact-btn--approve"
              onClick={() => onResolveRequest?.(approval.requestId, { behavior: "allow" })}
            >
              Approve
            </button>
            <button
              className="compact-btn compact-btn--deny"
              onClick={() =>
                onResolveRequest?.(approval.requestId, {
                  behavior: "deny",
                  message: "User denied",
                  interrupt: false,
                })
              }
            >
              Deny
            </button>
          </span>
        )}
        <span className="compact-log-status" style={{ color: borderColor }}>
          {statusIcon}
        </span>
      </div>
      {expanded && (
        <div className="compact-log-body">
          {rawInput && Object.keys(rawInput).filter(k => !k.startsWith("_")).length > 1 && (
            <ToolInputDetail input={rawInput} />
          )}
          {output && (
            <ToolOutputBody output={output} isError={isError} />
          )}
        </div>
      )}
    </div>
  );
}
