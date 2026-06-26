import type { ReactNode } from "react";
import { ChatMarkdown } from "./ChatMarkdown.tsx";
import { PRODUCT_NAME } from "@/constants/branding";

interface AssistantMessageProps {
  text: string;
  streaming?: boolean;
}

export function ThinkRailMessage({
  children,
  contentClassName,
}: {
  children: ReactNode;
  contentClassName?: string;
}) {
  return (
    <div className="chat-assistant">
      <div className="msg-avatar msg-avatar-assistant" aria-hidden="true">
        {PRODUCT_NAME.charAt(0)}
      </div>
      <div className={`msg-content ${contentClassName ?? ""}`}>
        <div className="msg-who">{PRODUCT_NAME}</div>
        <div className="msg-bubble msg-bubble-assistant">
          {children}
        </div>
      </div>
    </div>
  );
}

export function AssistantMessage({ text, streaming }: AssistantMessageProps) {
  return (
    <ThinkRailMessage>
      <ChatMarkdown content={text} />
      {streaming && <span className="chat-cursor" />}
    </ThinkRailMessage>
  );
}
