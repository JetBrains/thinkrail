interface AssistantMessageProps {
  text: string;
  streaming?: boolean;
}

export function AssistantMessage({ text, streaming }: AssistantMessageProps) {
  return (
    <div className="chat-assistant">
      <pre className="chat-assistant-text">{text}</pre>
      {streaming && <span className="chat-cursor" />}
    </div>
  );
}
