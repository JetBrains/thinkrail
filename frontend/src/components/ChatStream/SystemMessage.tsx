interface SystemMessageProps {
  text: string;
  variant?: "info" | "ok";
}

export function SystemMessage({ text, variant = "info" }: SystemMessageProps) {
  return (
    <div className={`chat-system ${variant === "ok" ? "chat-system-ok" : ""}`}>
      {text}
    </div>
  );
}
