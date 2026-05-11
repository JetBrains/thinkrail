import { ChatMarkdown } from "./ChatMarkdown.tsx";

interface AssistantMessageProps {
  text: string;
  streaming?: boolean;
}

export function AssistantMessage({ text, streaming }: AssistantMessageProps) {
  return (
    <div className="chat-assistant">
      <div className="msg-avatar msg-avatar-assistant" aria-hidden="true">B</div>
      <div className="msg-content">
        <div className="msg-who">Bonsai</div>
        <div className="msg-bubble msg-bubble-assistant">
          <ChatMarkdown content={text} />
          {streaming && <span className="chat-cursor" />}
        </div>
      </div>
    </div>
  );
}
