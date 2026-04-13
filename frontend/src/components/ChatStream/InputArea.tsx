import { useCallback, useEffect, useRef, useState } from "react";
import { useSettingsStore } from "@/store/settingsStore.ts";
import type { Skill } from "@/constants/skills";
import { useVoiceInput } from "@/hooks/useVoiceInput";
import { useNotificationStore } from "@/store/notificationStore";
import { useInputDraftStore } from "@/store/inputDraftStore";
import { isMod, modLabel } from "@/utils/platform";
import { ChatMarkdown } from "./ChatMarkdown";
import { MessageHistory } from "./MessageHistory";

interface InputAreaProps {
  sessionId: string;
  disabled: boolean;
  placeholder: string;
  onSend: (text: string, isMarkdown?: boolean) => void;
  isRunning?: boolean;
  canInterrupt?: boolean;
  onInterrupt?: () => void;
  showContinue?: boolean;
  onContinue?: () => void;
  isDraft?: boolean;
}

const FORMAT_ACTIONS = [
  { label: "B", title: `Bold (${modLabel("B")})`, prefix: "**", suffix: "**" },
  { label: "I", title: `Italic (${modLabel("I")})`, prefix: "*", suffix: "*" },
  { label: "</>", title: "Inline code", prefix: "`", suffix: "`" },
  { label: "\uD83D\uDD17", title: `Link (${modLabel("K")})`, prefix: "[", suffix: "](url)" },
  { label: "H", title: "Heading", prefix: "\n## ", suffix: "" },
  { label: "\u2022", title: "Bullet list", prefix: "\n- ", suffix: "" },
  { label: "1.", title: "Numbered list", prefix: "\n1. ", suffix: "" },
  { label: "\u275D", title: "Blockquote", prefix: "\n> ", suffix: "" },
  { label: "\u2014", title: "Horizontal rule", prefix: "\n---\n", suffix: "" },
  { label: "```", title: "Code block", prefix: "\n```\n", suffix: "\n```\n" },
];

export function InputArea({ sessionId, disabled, placeholder, onSend, isRunning, canInterrupt, onInterrupt, showContinue, onContinue, isDraft }: InputAreaProps) {
  const skills = useSettingsStore((s) => s.skills);
  const [text, setText] = useState(() => useInputDraftStore.getState().getDraft(sessionId));
  const [suggestions, setSuggestions] = useState<Skill[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [showHistory, setShowHistory] = useState(false);
  const [previewActive, setPreviewActive] = useState(false);
  const [splitRatio, setSplitRatio] = useState(0.5);
  const [panelHeight, setPanelHeight] = useState<number | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const splitPaneRef = useRef<HTMLDivElement>(null);
  const manualRef = useRef(false);
  const voice = useVoiceInput();
  const sessionIdRef = useRef(sessionId);
  useEffect(() => { sessionIdRef.current = sessionId; }, [sessionId]);

  /** Set local text state AND sync the draft store in one call. */
  const setTextAndDraft = useCallback((value: string) => {
    setText(value);
    useInputDraftStore.getState().setDraft(sessionIdRef.current, value);
  }, []);

  const isManual = panelHeight !== null;

  // Keep manualRef in sync so callbacks don't need panelHeight in deps
  useEffect(() => { manualRef.current = panelHeight !== null; }, [panelHeight]);

  // When entering manual mode, clear inline height so flex takes over
  useEffect(() => {
    if (isManual && ref.current) {
      ref.current.style.height = "";
    }
  }, [isManual]);

  // Sync local state when sessionId changes (e.g. switching between sessions)
  useEffect(() => {
    setText(useInputDraftStore.getState().getDraft(sessionId));
  }, [sessionId]);

  const closeSuggestions = useCallback(() => {
    setSuggestions([]);
    setSelectedIndex(0);
  }, []);

  const insertSkill = useCallback(
    (id: string) => {
      setTextAndDraft(`/${id} `);
      closeSuggestions();
      ref.current?.focus();
    },
    [closeSuggestions, setTextAndDraft],
  );

  const insertFormat = useCallback((prefix: string, suffix: string) => {
    const el = ref.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const selected = text.substring(start, end);
    const replacement = prefix + (selected || "text") + suffix;
    const newText = text.substring(0, start) + replacement + text.substring(end);
    setTextAndDraft(newText);
    const cursorPos = start + prefix.length + (selected || "text").length;
    setTimeout(() => {
      el.focus();
      el.setSelectionRange(cursorPos, cursorPos);
    }, 0);
  }, [text, setTextAndDraft]);

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (disabled) return;
    if (!trimmed && !isDraft) return;
    onSend(trimmed, true);
    setText("");
    useInputDraftStore.getState().clearDraft(sessionId);
    closeSuggestions();
    setPreviewActive(false);
    setPanelHeight(null);
    // Reset textarea height after clearing text
    setTimeout(() => {
      const el = ref.current;
      if (el) {
        el.style.height = "auto";
        el.style.height = el.scrollHeight + "px";
      }
    }, 0);
    ref.current?.focus();
  }, [text, disabled, isDraft, onSend, sessionId, closeSuggestions]);

  // -- Drag handle for panel resize --
  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startHeight = panelRef.current?.offsetHeight ?? 100;

    const onMove = (ev: MouseEvent) => {
      const delta = startY - ev.clientY;
      const newHeight = Math.max(56, Math.min(window.innerHeight * 0.7, startHeight + delta));
      setPanelHeight(newHeight);
    };

    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.body.style.cursor = "ns-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, []);

  // Double-click the handle to reset to auto-size
  const handleDragDoubleClick = useCallback(() => {
    setPanelHeight(null);
    setTimeout(() => {
      const el = ref.current;
      if (el) {
        el.style.height = "auto";
        el.style.height = el.scrollHeight + "px";
      }
    }, 0);
  }, []);

  // -- Horizontal split-pane drag handler --
  const handleSplitDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const paneWidth = splitPaneRef.current?.offsetWidth ?? 400;
    const startRatio = splitRatio;

    const onMove = (ev: MouseEvent) => {
      const newRatio = startRatio + (ev.clientX - startX) / paneWidth;
      setSplitRatio(Math.max(0.2, Math.min(0.8, newRatio)));
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [splitRatio]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const mod = isMod(e);

      // Mod+Enter always sends
      if (mod && e.key === "Enter") {
        e.preventDefault();
        handleSend();
        return;
      }

      // Markdown format shortcuts (always active)
      if (mod) {
        if (e.key.toLowerCase() === "b") {
          e.preventDefault();
          insertFormat("**", "**");
          return;
        }
        if (e.key.toLowerCase() === "i") {
          e.preventDefault();
          insertFormat("*", "*");
          return;
        }
        if (e.key.toLowerCase() === "k") {
          e.preventDefault();
          insertFormat("[", "](url)");
          return;
        }
      }

      // Mod+R toggles history popup
      if (isMod(e) && e.key === "r") {
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
    [handleSend, suggestions, selectedIndex, insertSkill, closeSuggestions, showHistory, insertFormat],
  );

  const handleChange = useCallback(
    (value: string) => {
      setTextAndDraft(value);
      if (value.startsWith("/")) {
        const query = value.slice(1).toLowerCase();
        const filtered = skills.filter((s) => s.id.includes(query));
        setSuggestions(filtered);
        setSelectedIndex(0);
        setShowHistory(false);
      } else {
        closeSuggestions();
      }
    },
    [closeSuggestions, setTextAndDraft, skills],
  );

  const handleHistorySelect = useCallback(
    (msg: string) => {
      setTextAndDraft(msg);
      setShowHistory(false);
      setTimeout(() => {
        const el = ref.current;
        if (el) {
          el.focus();
          if (!manualRef.current) {
            el.style.height = "auto";
            el.style.height = el.scrollHeight + "px";
          }
        }
      }, 0);
    },
    [setTextAndDraft],
  );

  const handleHistoryClose = useCallback(() => {
    setShowHistory(false);
    ref.current?.focus();
  }, []);

  const handleInput = useCallback(() => {
    if (manualRef.current) return; // In manual mode, flex layout handles sizing
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = el.scrollHeight + "px";
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
      setTextAndDraft(voice.interimText);
      setTimeout(() => {
        const el = ref.current;
        if (el && !manualRef.current) {
          el.style.height = "auto";
          el.style.height = el.scrollHeight + "px";
        }
      }, 0);
    }
  }, [voice.mode, voice.isRecording, voice.interimText, setTextAndDraft]);

  const handleMicClick = useCallback(async () => {
    if (voice.isRecording) {
      const transcript = await voice.stopRecording();
      if (transcript) {
        setTextAndDraft(transcript);
        setTimeout(() => {
          const el = ref.current;
          if (el) {
            el.focus();
            if (!manualRef.current) {
              el.style.height = "auto";
              el.style.height = el.scrollHeight + "px";
            }
          }
        }, 0);
      }
    } else {
      voice.startRecording();
    }
  }, [voice, setTextAndDraft]);

  // Handle Cmd/Ctrl+Enter in preview pane to send
  const handlePreviewKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (isMod(e) && e.key === "Enter") {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  return (
    <div
      className={`input-area${isManual ? " input-area--manual" : ""}`}
      ref={panelRef}
      style={isManual ? { height: panelHeight } : undefined}
    >
      <div
        className="input-resize-handle"
        onMouseDown={handleDragStart}
        onDoubleClick={handleDragDoubleClick}
      />
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
      <div className={`input-editor-wrapper${isManual ? " input-editor-wrapper--fill" : ""}`}>
        <div className="input-md-toolbar">
          <button
            className={`input-md-tab${previewActive ? " input-md-tab--active" : ""}`}
            onClick={() => {
              setPreviewActive((v) => !v);
              if (previewActive) setTimeout(() => ref.current?.focus(), 0);
            }}
          >
            Preview
          </button>
          <span className="input-md-sep" />
          {FORMAT_ACTIONS.map((action) => (
            <button
              key={action.label}
              className="input-md-fmt"
              title={action.title}
              onMouseDown={(e) => {
                e.preventDefault();
                insertFormat(action.prefix, action.suffix);
              }}
            >
              {action.label}
            </button>
          ))}
        </div>
        <div className="input-split-pane" ref={splitPaneRef}>
          <textarea
            ref={ref}
            className={`input-textarea input-textarea--md${isManual ? " input-textarea--fill" : ""}${previewActive ? " input-textarea--split" : ""}`}
            style={previewActive ? { flex: splitRatio } : undefined}
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
          {previewActive && (
            <>
              <div className="input-split-divider" onMouseDown={handleSplitDragStart} />
              <div
                className={`input-preview${isManual ? " input-preview--fill" : ""}`}
                style={{ flex: 1 - splitRatio }}
                tabIndex={0}
                onKeyDown={handlePreviewKeyDown}
              >
                {text.trim() ? (
                  <ChatMarkdown content={text} />
                ) : (
                  <span className="input-preview-empty">Nothing to preview</span>
                )}
              </div>
            </>
          )}
        </div>
      </div>
      <button
        className="input-history-btn"
        onClick={() => {
          closeSuggestions();
          setShowHistory((v) => !v);
        }}
        title={`Message history (${modLabel("R")})`}
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
        {canInterrupt && onInterrupt && (
          <button className="input-interrupt" onClick={onInterrupt}>{"\u25A0"}</button>
        )}
        {!(isRunning && onInterrupt) && (
          <button
            className="input-send"
            onClick={handleSend}
            disabled={disabled || (!isDraft && !text.trim())}
          >
            {isDraft ? "Start" : "Send"}
          </button>
        )}
      </div>
    </div>
  );
}
