import { useCallback, useEffect, useRef, useState } from "react";
import { useSessionStore } from "@/store/sessionStore";
import { useNotificationStore } from "@/store/notificationStore";
import { useVoiceInput } from "@/hooks/useVoiceInput";
import { buildDefaultSessionConfig } from "@/utils/sessionConfig";
import type { Session } from "@/types/session";
import { modLabel } from "@/utils/platform";
import "./WelcomeScreen.css";

const STATUS_COLORS: Record<string, string> = {
  running: "var(--blue)",
  waiting: "var(--blue)",
  initializing: "var(--gold)",
  interrupted: "var(--gold)",
  idle: "var(--hint)",
  done: "var(--green)",
  error: "var(--red)",
};

interface WelcomeScreenProps {
  sessions: Session[];
  onSwitchSession: (id: string) => void;
}

export function WelcomeScreen({ sessions, onSwitchSession }: WelcomeScreenProps) {
  const [input, setInput] = useState("");
  const [sessionName, setSessionName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const startSession = useSessionStore((s) => s.startSession);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const voice = useVoiceInput();

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  // Toast on voice errors
  useEffect(() => {
    if (voice.error) {
      useNotificationStore.getState().addToast({ eventType: "error", message: voice.error, persistent: false });
    }
  }, [voice.error]);

  // Sync interim speech-api text into the input field
  useEffect(() => {
    if (voice.mode === "speech-api" && voice.isRecording && voice.interimText) {
      setInput(voice.interimText);
    }
  }, [voice.mode, voice.isRecording, voice.interimText]);

  const handleMicClick = useCallback(async () => {
    if (voice.isRecording) {
      const transcript = await voice.stopRecording();
      if (transcript) {
        setInput(transcript);
        setTimeout(() => textareaRef.current?.focus(), 0);
      }
    } else {
      voice.startRecording();
    }
  }, [voice]);

  const handleStart = useCallback(async () => {
    const text = input.trim();
    if (!text || submitting) return;
    setSubmitting(true);
    try {
      await startSession({
        specIds: [],
        config: await buildDefaultSessionConfig(),
        name: sessionName.trim() || text.slice(0, 60),
        prompt: text,
      });
    } catch {
      setSubmitting(false);
    }
  }, [input, sessionName, submitting, startSession]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleStart();
      }
    },
    [handleStart],
  );

  return (
    <div className="welcome-screen">
      <div className="welcome-card">
        <div className="welcome-title">What do you want to work on?</div>
        <input
          className="welcome-name-input"
          type="text"
          placeholder="Session name (optional)"
          value={sessionName}
          onChange={(e) => setSessionName(e.target.value)}
          disabled={submitting}
          maxLength={80}
        />
        <div className="welcome-textarea-wrap">
          <textarea
            ref={textareaRef}
            className="welcome-textarea"
            placeholder={voice.isTranscribing ? "Transcribing…" : "Describe a task…"}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={3}
            disabled={submitting || voice.isTranscribing}
          />
          {voice.isSupported && (
            <button
              className={`welcome-mic${voice.isRecording ? " welcome-mic--recording" : ""}${voice.isTranscribing ? " welcome-mic--transcribing" : ""}`}
              onClick={handleMicClick}
              disabled={submitting || voice.isTranscribing}
              title={voice.isRecording ? "Stop recording" : "Voice input"}
              tabIndex={-1}
            >
              {voice.isTranscribing ? (
                <span className="input-mic-spinner" />
              ) : (
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <rect x="4.5" y="1" width="5" height="7" rx="2.5" fill="currentColor"/>
                  <path d="M2 6.5C2 9.261 4.239 11.5 7 11.5C9.761 11.5 12 9.261 12 6.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                  <line x1="7" y1="11.5" x2="7" y2="13" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                </svg>
              )}
            </button>
          )}
        </div>
        <div className="welcome-footer">
          <span className="welcome-hint">{modLabel("↵")} to start</span>
          <button
            className="welcome-start-btn"
            onClick={handleStart}
            disabled={!input.trim() || submitting}
          >
            {submitting ? "Starting…" : "Start"}
          </button>
        </div>

        {sessions.length > 0 && (
          <div className="welcome-sessions">
            <div className="welcome-sessions-label">Open sessions</div>
            {sessions.map((s) => (
              <button
                key={s.bonsaiSid}
                className="welcome-session-item"
                onClick={() => onSwitchSession(s.bonsaiSid)}
              >
                <span
                  className="welcome-session-dot"
                  style={{ background: STATUS_COLORS[s.status] ?? "var(--hint)" }}
                />
                <span className="welcome-session-name">{s.name}</span>
                <span className="welcome-session-status">{s.status}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
