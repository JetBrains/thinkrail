import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useUiStore } from "@/store/uiStore";
import { useNotificationStore } from "@/store/notificationStore";
import { useVoiceInput } from "@/hooks/useVoiceInput";
import { browseFolder } from "@/services/fs";
import { entryTransition } from "./registry";
import { useStartWizardStep } from "./useStartWizardStep";
import { FullScreenLayout } from "./FullScreenLayout";
import { Button } from "@/components/ui/Button";
import { PRODUCT_NAME } from "@/constants/branding";
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
  const [projectPath, setProjectPath] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [attachedFile, setAttachedFile] = useState<{ name: string; content: string } | null>(null);
  const [nameError, setNameError] = useState(false);
  const [pathError, setPathError] = useState(false);
  const startWizardStep = useStartWizardStep();
  const setProjectState = useUiStore((s) => s.setProjectState);
  const setCenterView = useUiStore((s) => s.setCenterView);
  const setCurrentChain = useUiStore((s) => s.setCurrentChain);
  const setStoreProjectPath = useUiStore((s) => s.setProject);
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

  const handleBrowseFolder = useCallback(async () => {
    try {
      const data = await browseFolder();
      if (data?.path) {
        setProjectPath(data.path);
        setPathError(false);
      }
    } catch {
      // User cancelled or error - ignore
    }
  }, []);

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
    const path = projectPath.trim();

    if (!name) {
      setNameError(true);
      return;
    }
    if (!path) {
      setPathError(true);
      return;
    }
    if (!text && !attachedFile) return;
    if (submitting) return;

    setSubmitting(true);
    setProjectState("initialized");
    setCenterView("sessions");
    setStoreProjectPath(path);

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
  }, [input, sessionName, projectPath, attachedFile, submitting, startWizardStep, setProjectState, setCenterView, setStoreProjectPath]);

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

  return (
    <FullScreenLayout>
      <div className="np-form-header">
        <h2 className="np-form-h2">Describe Your Project</h2>
        <p className="np-form-lead">
          {PRODUCT_NAME} will help shape your idea into a clear Goal &amp; Requirements document.
        </p>
      </div>

      <div className="np-form-fields">
        <div className="np-form-field">
            <div className="np-form-label">Project name</div>
            <input
              className={`np-form-input${nameError ? " np-form-input--error" : ""}`}
              type="text"
              placeholder="e.g. inventory service"
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
            <div className="np-form-label">Location</div>
            <button
              type="button"
              className={`np-form-location${pathError ? " np-form-location--error" : ""}`}
              onClick={handleBrowseFolder}
              disabled={submitting}
            >
              <span className="np-form-location-text">
                {projectPath || "choose root folder"}
              </span>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M2 4.5C2 3.67157 2.67157 3 3.5 3H5.87868C6.17413 3 6.45732 3.1173 6.66421 3.32421L7.83579 4.49579C8.04268 4.7027 8.32587 4.82 8.62132 4.82H12.5C13.3284 4.82 14 5.49157 14 6.32V11.5C14 12.3284 13.3284 13 12.5 13H3.5C2.67157 13 2 12.3284 2 11.5V4.5Z" stroke="currentColor" strokeWidth="1.2"/>
              </svg>
            </button>
            {pathError && (
              <div className="np-form-name-error">Please choose a folder</div>
            )}
          </div>

          <div className="np-form-field">
            <div className="np-form-label">Description</div>
            <div className="np-form-textarea-wrap">
              <textarea
                ref={textareaRef}
                className="np-form-textarea"
                placeholder={
                  voice.isTranscribing
                    ? "Transcribing…"
                    : "describe your project idea, goals, or attach a document below"
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
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
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
        </div>

        <div className="np-form-actions">
          <div className="np-form-actions-buttons">
            <Button
              onClick={handleCancel}
              disabled={submitting}
              type="button"
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleStart}
              disabled={!canSubmit}
              type="button"
              trailingIcon={
                <svg className="np-form-btn-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <path d="M5 12h14M13 5l7 7-7 7"/>
                </svg>
              }
            >
              {submitting ? "Starting…" : "Next"}
            </Button>
        </div>
      </div>
    </FullScreenLayout>
  );
}
