import type { ReactNode } from "react";

interface SubagentBlockProps {
  agentType?: string;
  finished: boolean;
  children: ReactNode;
}

export function SubagentBlock({
  agentType,
  finished,
  children,
}: SubagentBlockProps) {
  return (
    <div className="chat-subagent">
      <div className="chat-subagent-header">
        <span>{finished ? "\u2713" : "\u26A1"}</span>
        <span>Subagent: {agentType ?? "agent"}</span>
        {!finished && <span className="chat-spinner" />}
      </div>
      <div className="chat-subagent-body">{children}</div>
    </div>
  );
}
