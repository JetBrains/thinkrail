import { ChatMarkdown } from "./ChatMarkdown.tsx";

interface AssistantMessageProps {
  text: string;
  streaming?: boolean;
}

export function AssistantMessage({ text, streaming }: AssistantMessageProps) {
  return (
    <div className="chat-assistant">
      <ChatMarkdown content={text} />
      {streaming && <span className="chat-cursor" />}
    </div>
  );
}
