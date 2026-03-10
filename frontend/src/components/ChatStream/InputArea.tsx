import { useCallback, useEffect, useRef, useState } from "react";
import { SKILLS } from "@/constants/skills";
import { useVoiceInput } from "@/hooks/useVoiceInput";
import { useNotificationStore } from "@/store/notificationStore";
import { MessageHistory } from "./MessageHistory";

interface InputAreaProps {
  disabled: boolean;
  placeholder: string;
  onSend: (text: string) => void;
  isRunning?: boolean;
  onInterrupt?: () => void;
  showContinue?: boolean;
  onContinue?: () => void;
}

export function InputArea({ disabled, placeholder, onSend, isRunning, onInterrupt, showContinue, onContinue }: InputAreaProps) {
  const [text, setText] = useState("");
  const [suggestions, setSuggestions] = useState<typeof SKILLS>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [showHistory, setShowHistory] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const voice = useVoiceInput();

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

      // Ctrl+R toggles history popup
      if (e.ctrlKey && e.key === "r") {
        e.preventDefault();
        closeSuggestions();
        setShowHistory((v) => !v);
        return;
      }

      // Escape closes history popup
      if (e.key === "Escape" && showHistory) {
        e.preventDefault();
        setShowHistory(false);
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
    [handleSend, suggestions, selectedIndex, insertSkill, closeSuggestions, showHistory],
  );

  const handleChange = useCallback(
    (value: string) => {
      setText(value);
      if (value.startsWith("/")) {
        const query = value.slice(1).toLowerCase();
        const filtered = SKILLS.filter((s) => s.id.includes(query));
        setSuggestions(filtered);
        setSelectedIndex(0);
        setShowHistory(false);
      } else {
        closeSuggestions();
      }
    },
    [closeSuggestions],
  );

  const handleHistorySelect = useCallback(
    (msg: string) => {
      setText(msg);
      setShowHistory(false);
      // Defer focus and resize to next tick so the textarea value is updated
      setTimeout(() => {
        const el = ref.current;
        if (el) {
          el.focus();
          el.style.height = "auto";
          el.style.height = Math.min(el.scrollHeight, 150) + "px";
        }
      }, 0);
    },
    [],
  );

  const handleHistoryClose = useCallback(() => {
    setShowHistory(false);
    ref.current?.focus();
  }, []);

  const handleInput = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 150) + "px";
  }, []);

  // Show voice input errors as toasts
  useEffect(() => {
    if (voice.error) {
      useNotificationStore.getState().addToast({
        eventType: "error",
        message: voice.error,
        persistent: false,
      });
    }
  }, [voice.error]);

  // Sync interim text from Web Speech API into textarea
  useEffect(() => {
    if (voice.mode === "speech-api" && voice.isRecording && voice.interimText) {
      setText(voice.interimText);
      // Resize textarea to fit
      setTimeout(() => {
        const el = ref.current;
        if (el) {
          el.style.height = "auto";
          el.style.height = Math.min(el.scrollHeight, 150) + "px";
        }
      }, 0);
    }
  }, [voice.mode, voice.isRecording, voice.interimText]);

  const handleMicClick = useCallback(async () => {
    if (voice.isRecording) {
      const transcript = await voice.stopRecording();
      if (transcript) {
        setText(transcript);
        setTimeout(() => {
          const el = ref.current;
          if (el) {
            el.focus();
            el.style.height = "auto";
            el.style.height = Math.min(el.scrollHeight, 150) + "px";
          }
        }, 0);
      }
    } else {
      voice.startRecording();
    }
  }, [voice]);

  return (
    <div className="input-area" style={{ position: "relative" }}>
      {showHistory && (
        <MessageHistory onSelect={handleHistorySelect} onClose={handleHistoryClose} />
      )}
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
        placeholder={voice.isTranscribing ? "Transcribing..." : placeholder}
        disabled={disabled || voice.isTranscribing}
        rows={1}
      />
      <button
        className="input-history-btn"
        onClick={() => {
          closeSuggestions();
          setShowHistory((v) => !v);
        }}
        title="Message history (Ctrl+R)"
      >
        {"\u2191"}
      </button>
      {voice.isSupported && (
        <button
          className={`input-mic${voice.isRecording ? " input-mic-recording" : ""}${voice.isTranscribing ? " input-mic-transcribing" : ""}`}
          onClick={handleMicClick}
          disabled={disabled || voice.isTranscribing}
          title={voice.isRecording ? "Stop recording" : "Start voice input"}
        >
          {voice.isTranscribing ? <span className="input-mic-spinner" /> : "\uD83C\uDF99"}
        </button>
      )}
      <div className="input-actions">
        {showContinue && onContinue && (
          <button className="input-continue" onClick={onContinue} title="Continue without a message">
            Continue
          </button>
        )}
        {isRunning && onInterrupt ? (
          <button className="input-interrupt" onClick={onInterrupt}>{"\u25A0"}</button>
        ) : (
          <button
            className="input-send"
            onClick={handleSend}
            disabled={disabled || !text.trim()}
          >
            Send
          </button>
        )}
      </div>
    </div>
  );
}
