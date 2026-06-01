import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useUiStore } from "@/store/uiStore";
import { useNotificationStore } from "@/store/notificationStore";
import { useVoiceInput } from "@/hooks/useVoiceInput";
import { WizardStepper } from "./WizardStepper";
import { getWizardConfig, entryTransition } from "./registry";
import { useStartWizardStep } from "./useStartWizardStep";
import { derivePhase } from "./phase";
import "./NewProjectForm.css";

// This chain's identity. The skill + the session_prompt builder come
// from the wizard registry (single source); this form only collects the
// raw inputs (name, idea, attached doc) and hands them to the entry
// transition.
const CHAIN_ID = "new-project";
const ENTRY = entryTransition(CHAIN_ID);

/**
 * The "Describe" step of the new-project wizard chain. Collects a name,
 * an idea description, and an optional attached doc. On submit, starts a
 * session with `skillId: "new-project"` — AppShell then takes over and
 * renders the chat+doc wizard layout for the running session.
 */
export function NewProjectForm() {
  const [input, setInput] = useState("");
  const [sessionName, setSessionName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [attachedFile, setAttachedFile] = useState<{ name: string; content: string } | null>(null);
  const [nameError, setNameError] = useState(false);
  const startWizardStep = useStartWizardStep();
  const setProjectState = useUiStore((s) => s.setProjectState);
  const setCenterView = useUiStore((s) => s.setCenterView);
  const setCurrentChain = useUiStore((s) => s.setCurrentChain);
  const navigate = useNavigate();

  // Pin the new-project chain so AppShell renders new-project's own
  // stepper labels and not the investigate-project chain labels.
  useEffect(() => {
    setCurrentChain("new-project");
  }, [setCurrentChain]);
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
    setProjectState("initialized");
    setCenterView("sessions");

    // Fold the optional attached doc into the idea text; the registry's
    // entry transition turns (name + idea) into the session_prompt.
    const ideaParts: string[] = [];
    if (text) ideaParts.push(text);
    if (attachedFile) {
      ideaParts.push(`--- Attached: ${attachedFile.name} ---\n${attachedFile.content}`);
    }
    const prompt =
      ENTRY?.buildPrompt?.({ projectName: name, ideaText: ideaParts.join("\n\n") }) ??
      [`Project name: ${name}`, ...ideaParts].join("\n\n");

    try {
      // The idea text is the kick message (not a session_prompt) for the
      // greenfield entry — the agent's first turn reacts to it directly.
      await startWizardStep({
        skillId: ENTRY?.target ?? CHAIN_ID,
        chainId: CHAIN_ID,
        name,
        kick: prompt,
      });
    } catch {
      setProjectState("new");
      setSubmitting(false);
    }
  }, [input, sessionName, attachedFile, submitting, startWizardStep, setProjectState, setCenterView]);

  const handleCancel = useCallback(() => {
    navigate("/");
  }, [navigate]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleStart();
      }
    },
    [handleStart],
  );

  const canSubmit = !submitting && (!!input.trim() || !!attachedFile);

  // The form is the pre-chat phase of new-project — derivePhase(null)
  // returns "pre-chat", and the registry resolves that to "Describe":active.
  // Phase is NEVER hardcoded here: if the phase derivation rule changes
  // (e.g. a new lifecycle stage is added), this page picks it up
  // automatically. Falls back to an empty stepper if the registry is
  // mis-wired (defensive).
  const formStepperSteps =
    getWizardConfig(CHAIN_ID, derivePhase({ session: null }))?.steps ?? [];

  return (
    <div className="np-form-screen">
      <WizardStepper steps={formStepperSteps} />

      <div className="np-form">
        <h2 className="np-form-h2">What are your project goals?</h2>
        <p className="np-form-lead">
          Describe your idea — Bonsai will help shape it into a clear Goal &amp; Requirements document.
        </p>

        <div className="np-form-field">
          <div className="np-form-label">Project name</div>
          <input
            className={`np-form-input${nameError ? " np-form-input--error" : ""}`}
            type="text"
            placeholder="e.g. inventory-service"
            value={sessionName}
            onChange={(e) => { setSessionName(e.target.value); setNameError(false); }}
            disabled={submitting}
            maxLength={80}
            required
          />
          {nameError && (
            <div className="np-form-name-error">Please enter a project name</div>
          )}
        </div>

        <div className="np-form-field">
          <div className="np-form-label">Goals · what should this project do</div>
          <div className="np-form-textarea-wrap">
            <textarea
              ref={textareaRef}
              className="np-form-textarea"
              placeholder={
                voice.isTranscribing
                  ? "Transcribing…"
                  : "Describe your goals, ideas, or attach a doc below…"
              }
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={6}
              disabled={submitting || voice.isTranscribing}
            />
            {voice.isSupported && (
              <button
                className={`np-form-mic${voice.isRecording ? " np-form-mic--recording" : ""}${voice.isTranscribing ? " np-form-mic--transcribing" : ""}`}
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
          <div className="np-form-attach-row">
            <input
              ref={fileInputRef}
              type="file"
              accept=".txt,.md,.pdf,.doc,.docx,.rtf,.csv,.json,.yaml,.yml"
              style={{ display: "none" }}
              onChange={handleFileChange}
            />
            <button
              className="np-form-attach-btn"
              onClick={() => fileInputRef.current?.click()}
              disabled={submitting}
              type="button"
            >
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M13.5 8L8 13.5C6.619 14.881 4.381 14.881 3 13.5C1.619 12.119 1.619 9.881 3 8.5L9 2.5C9.928 1.572 11.428 1.572 12.356 2.5C13.284 3.428 13.284 4.928 12.356 5.856L6.35 11.863C5.864 12.349 5.077 12.349 4.591 11.863C4.105 11.377 4.105 10.59 4.591 10.104L10 4.7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              {attachedFile ? "Replace file" : "Attach document"}
            </button>
            {attachedFile ? (
              <span className="np-form-attached-file">
                {attachedFile.name}
                <button
                  className="np-form-attached-remove"
                  onClick={() => setAttachedFile(null)}
                  title="Remove"
                >×</button>
              </span>
            ) : (
              <span className="np-form-hint">
                PDF, Markdown, plain text — anything you've already written about the idea.
              </span>
            )}
          </div>
        </div>

        <div className="np-form-actions">
          <span className="np-form-hint">
            <span className="np-form-kbd">⌘</span> <span className="np-form-kbd">↵</span> to start
          </span>
          <div className="np-form-actions-buttons">
            <button
              className="np-form-btn"
              onClick={handleCancel}
              disabled={submitting}
              type="button"
            >
              Cancel
            </button>
            <button
              className="np-form-btn np-form-btn-primary"
              onClick={handleStart}
              disabled={!canSubmit}
              type="button"
            >
              {submitting ? "Starting…" : "Define goals"}
              <svg className="np-form-btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path d="M5 12h14M13 5l7 7-7 7"/>
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
