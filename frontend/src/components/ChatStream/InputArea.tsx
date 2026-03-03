import { useCallback, useRef, useState } from "react";

interface InputAreaProps {
  disabled: boolean;
  placeholder: string;
  onSend: (text: string) => void;
}

export function InputArea({ disabled, placeholder, onSend }: InputAreaProps) {
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setText("");
    ref.current?.focus();
  }, [text, disabled, onSend]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  const handleInput = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 150) + "px";
  }, []);

  return (
    <div className="input-area">
      <textarea
        ref={ref}
        className="input-textarea"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          handleInput();
        }}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        rows={1}
      />
      <button
        className="input-send"
        onClick={handleSend}
        disabled={disabled || !text.trim()}
      >
        Send
      </button>
    </div>
  );
}
