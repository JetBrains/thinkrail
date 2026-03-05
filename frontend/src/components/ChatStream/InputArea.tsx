import { useCallback, useRef, useState } from "react";
import { SKILLS } from "@/constants/skills";

interface InputAreaProps {
  disabled: boolean;
  placeholder: string;
  onSend: (text: string) => void;
}

export function InputArea({ disabled, placeholder, onSend }: InputAreaProps) {
  const [text, setText] = useState("");
  const [suggestions, setSuggestions] = useState<typeof SKILLS>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const ref = useRef<HTMLTextAreaElement>(null);

  const closeSuggestions = useCallback(() => {
    setSuggestions([]);
    setSelectedIndex(0);
  }, []);

  const insertSkill = useCallback(
    (id: string) => {
      setText(`/${id} `);
      closeSuggestions();
      ref.current?.focus();
    },
    [closeSuggestions],
  );

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setText("");
    closeSuggestions();
    ref.current?.focus();
  }, [text, disabled, onSend, closeSuggestions]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Cmd/Ctrl+Enter always sends
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        handleSend();
        return;
      }

      if (suggestions.length === 0) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => (i + 1) % suggestions.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => (i - 1 + suggestions.length) % suggestions.length);
      } else if (e.key === "Tab" || e.key === "Enter") {
        e.preventDefault();
        insertSkill(suggestions[selectedIndex].id);
      } else if (e.key === "Escape") {
        e.preventDefault();
        closeSuggestions();
      }
    },
    [handleSend, suggestions, selectedIndex, insertSkill, closeSuggestions],
  );

  const handleChange = useCallback(
    (value: string) => {
      setText(value);
      if (value.startsWith("/")) {
        const query = value.slice(1).toLowerCase();
        const filtered = SKILLS.filter((s) => s.id.includes(query));
        setSuggestions(filtered);
        setSelectedIndex(0);
      } else {
        closeSuggestions();
      }
    },
    [closeSuggestions],
  );

  const handleInput = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 150) + "px";
  }, []);

  return (
    <div className="input-area" style={{ position: "relative" }}>
      {suggestions.length > 0 && (
        <div className="input-autocomplete">
          {suggestions.map((skill, i) => (
            <button
              key={skill.id}
              ref={i === selectedIndex ? (el) => el?.scrollIntoView({ block: "nearest" }) : undefined}
              className={`input-autocomplete-item ${i === selectedIndex ? "input-autocomplete-active" : ""}`}
              onMouseDown={(e) => {
                e.preventDefault();
                insertSkill(skill.id);
              }}
            >
              <span className="input-autocomplete-icon">{skill.icon}</span>
              <span className="input-autocomplete-name">/{skill.id}</span>
              <span className="input-autocomplete-desc">{skill.description}</span>
            </button>
          ))}
        </div>
      )}
      <textarea
        ref={ref}
        className="input-textarea"
        value={text}
        onChange={(e) => {
          handleChange(e.target.value);
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
