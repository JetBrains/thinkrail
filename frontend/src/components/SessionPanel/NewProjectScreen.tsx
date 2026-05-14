import { useCallback, useEffect, useRef, useState } from "react";
import { useSessionStore } from "@/store/sessionStore";
import { useUiStore } from "@/store/uiStore";
import { useNotificationStore } from "@/store/notificationStore";
import { useVoiceInput } from "@/hooks/useVoiceInput";
import { buildDefaultSessionConfig } from "@/utils/sessionConfig";
import "./WelcomeScreen.css";
import "./NewProjectScreen.css";

export function NewProjectScreen() {
  const [input, setInput] = useState("");
  const [sessionName, setSessionName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [attachedFile, setAttachedFile] = useState<{ name: string; content: string } | null>(null);
  const [nameError, setNameError] = useState(false);
  const startSession = useSessionStore((s) => s.startSession);
  const setProjectState = useUiStore((s) => s.setProjectState);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const voice = useVoiceInput();

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  useEffect(() => {
    if (voice.error) {
      useNotificationStore.getState().addToast({ eventType: "error", message: voice.error, persistent: false });
    }
  }, [voice.error]);

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

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      const content = evt.target?.result as string;
      setAttachedFile({ name: file.name, content });
    };
    reader.readAsText(file);
    e.target.value = "";
  }, []);

  const handleStart = useCallback(async () => {
    const text = input.trim();
    const name = sessionName.trim();
    if (!name) {
      setNameError(true);
      return;
    }
    if (!text && !attachedFile) return;
    if (submitting) return;
    setSubmitting(true);
    // Optimistically leave the new-project screen — first message kicks
    // off the agent which materializes .bonsai/ on its first persist.
    setProjectState("initialized");

    const parts: string[] = [];
    parts.push(`Project name: ${name}`);
    if (text) parts.push(text);
    if (attachedFile) {
      parts.push(`--- Attached: ${attachedFile.name} ---\n${attachedFile.content}`);
    }
    const prompt = parts.join("\n\n");

    try {
      const bonsaiSid = await startSession({
        specIds: [],
        config: await buildDefaultSessionConfig(),
        name,
        skillId: "new-project",
      });
      // Send the prompt as the first user message so it appears in ChatStream
      // and triggers the agent to start the new-project skill flow.
      await useSessionStore.getState().sendMessage(bonsaiSid, prompt);
    } catch {
      setProjectState("new");
      setSubmitting(false);
    }
  }, [input, sessionName, attachedFile, submitting, startSession, setProjectState]);

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
        <div className="welcome-title">What are your project goals?</div>
        <div className="welcome-subtitle" style={{ fontSize: 12, color: "var(--hint)", marginTop: -6 }}>
          Describe your idea — we'll help shape it into a clear goal and requirements
        </div>
        <input
          className={`welcome-name-input${nameError ? " welcome-name-input--error" : ""}`}
          type="text"
          placeholder="Project name (required)"
          value={sessionName}
          onChange={(e) => { setSessionName(e.target.value); setNameError(false); }}
          disabled={submitting}
          maxLength={80}
          required
        />
        {nameError && (
          <div className="np-name-error">Please enter a project name</div>
        )}
        <div className="welcome-textarea-wrap">
          <textarea
            ref={textareaRef}
            className="welcome-textarea"
            placeholder={
              voice.isTranscribing
                ? "Transcribing…"
                : "Describe your goals, ideas, or attach a doc below…"
            }
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={5}
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
        <div className="np-attach-row">
          <input
            ref={fileInputRef}
            type="file"
            accept=".txt,.md,.pdf,.doc,.docx,.rtf,.csv,.json,.yaml,.yml"
            style={{ display: "none" }}
            onChange={handleFileChange}
          />
          <button
            className="np-attach-btn"
            onClick={() => fileInputRef.current?.click()}
            disabled={submitting}
            type="button"
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M13.5 8L8 13.5C6.619 14.881 4.381 14.881 3 13.5C1.619 12.119 1.619 9.881 3 8.5L9 2.5C9.928 1.572 11.428 1.572 12.356 2.5C13.284 3.428 13.284 4.928 12.356 5.856L6.35 11.863C5.864 12.349 5.077 12.349 4.591 11.863C4.105 11.377 4.105 10.59 4.591 10.104L10 4.7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            {attachedFile ? "Replace file" : "Attach document"}
          </button>
          {attachedFile && (
            <span className="np-attached-file">
              {attachedFile.name}
              <button
                className="np-attached-remove"
                onClick={() => setAttachedFile(null)}
                title="Remove"
              >×</button>
            </span>
          )}
        </div>

        <div className="welcome-footer">
          <span className="welcome-hint">⌘↵ to start</span>
          <button
            className="welcome-start-btn"
            onClick={handleStart}
            disabled={(!input.trim() && !attachedFile) || submitting}
          >
            {submitting ? "Starting…" : "Define Goals"}
          </button>
        </div>
      </div>
    </div>
  );
}
