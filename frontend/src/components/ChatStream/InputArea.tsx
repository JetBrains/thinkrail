import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSettingsStore } from "@/store/settingsStore.ts";
import { useRuntimeCapsStore } from "@/store/runtimeCapsStore.ts";
import { useSessionStore } from "@/store/sessionStore.ts";
import { useVoiceInput } from "@/hooks/useVoiceInput";
import {
  extractSlashToken,
  useSlashAutocomplete,
} from "@/hooks/useSlashAutocomplete.ts";
import { useNotificationStore } from "@/store/notificationStore";
import { useInputDraftStore } from "@/store/inputDraftStore";
import * as draftAutosave from "@/store/draftAutosave";
import { isMod, modLabel } from "@/utils/platform";
import type { VoiceReviseMode } from "@/api/methods/settings.ts";
import type { RuntimeType } from "@/types/agent.ts";
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
  /** Session-lifecycle buttons (Continue / Start / Stop) portal into
   *  this slot inside SessionStatusLine.  Send stays here next to the
   *  textarea \u2014 it acts on the *message*, not the session. */
  actionPortalTarget?: HTMLElement | null;
}

// Inline SVG icons (lucide-style, MIT-licensed open-source set).
const IconMic = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
    <line x1="12" x2="12" y1="19" y2="22" />
  </svg>
);
const IconHistory = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 12a9 9 0 1 0 3-7.7" />
    <path d="M3 4v5h5" />
    <path d="M12 7v5l3 2" />
  </svg>
);
const IconMore = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="5" cy="12" r="1" />
    <circle cx="12" cy="12" r="1" />
    <circle cx="19" cy="12" r="1" />
  </svg>
);
const IconStop = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <rect x="5" y="5" width="14" height="14" rx="2" />
  </svg>
);
const IconPlay = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M7 5v14l12-7-12-7z" />
  </svg>
);

export function InputArea({ sessionId, disabled, placeholder, onSend, isRunning, canInterrupt, onInterrupt, showContinue, onContinue, isDraft, actionPortalTarget }: InputAreaProps) {
  const voiceReviseMode: VoiceReviseMode =
    (useSettingsStore((s) => s.settings?.voice_revise_mode) as VoiceReviseMode | undefined) ?? "off";
  // Derive the active runtime from the session's model via the runtime
  // registry — there's no `session.runtime` field today, so we look up
  // whichever runtime owns the selected model id.  Falls back to "claude"
  // (the only registered runtime today) so the autocomplete still works
  // for drafts that haven't picked a model yet.
  const sessionModel = useSessionStore((s) => s.sessions.get(sessionId)?.model);
  const capsByRuntime = useRuntimeCapsStore((s) => s.capsByRuntime);
  const sessionRuntime: RuntimeType | undefined = useMemo(() => {
    if (!sessionModel) return undefined;
    const hit = Object.entries(capsByRuntime).find(
      ([, caps]) => caps.models.some((m) => m.value === sessionModel),
    );
    return hit?.[0] as RuntimeType | undefined;
  }, [sessionModel, capsByRuntime]);
  const effectiveRuntime: RuntimeType = sessionRuntime ?? "claude";
  const loadRuntimeSkills = useSettingsStore((s) => s.loadRuntimeSkills);
  // Single source of truth: textarea value is driven by the draft store
  // (keyed by sessionId so drafts persist across session switches).
  const text = useInputDraftStore((s) => s.drafts.get(sessionId) ?? "");
  const [caret, setCaret] = useState(0);
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

  // Refresh the runtime skill cache on session/runtime change.  Silent on
  // failure (the store action only logs to console.debug — see design doc
  // §6.5) so the popup gracefully falls back to a Bonsai-only list.
  useEffect(() => {
    loadRuntimeSkills(effectiveRuntime);
  }, [effectiveRuntime, loadRuntimeSkills]);

  const setTextAndDraft = useCallback((value: string) => {
    useInputDraftStore.getState().setDraft(sessionIdRef.current, value);
  }, []);

  const clearTextAndDraft = useCallback(() => {
    useInputDraftStore.getState().clearDraft(sessionIdRef.current);
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

  // Apply the autocomplete hook's chosen insertion (start/end describe the
  // active /token; replacement is "/<id> ").  Splice it into the textarea
  // text, then move the caret right after the trailing space.  Per design
  // doc §6.4 we keep text *before* the token (`text.slice(0, start)`) and
  // *after* (`text.slice(end)`) intact.
  const applyInsert = useCallback(
    ({
      start,
      end,
      replacement,
      caretAfter,
    }: {
      start: number;
      end: number;
      replacement: string;
      caretAfter: number;
    }) => {
      const next = text.slice(0, start) + replacement + text.slice(end);
      setTextAndDraft(next);
      // Defer caret placement until after React commits the new value.
      queueMicrotask(() => {
        const el = ref.current;
        if (!el) return;
        el.focus();
        try {
          el.setSelectionRange(caretAfter, caretAfter);
        } catch {
          /* setSelectionRange can throw on detached nodes — ignore */
        }
        setCaret(caretAfter);
      });
    },
    [text, setTextAndDraft],
  );

  const autocomplete = useSlashAutocomplete({
    text,
    caret,
    runtime: effectiveRuntime,
    onInsert: applyInsert,
  });

  const closeSuggestions = autocomplete.close;

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

  const [isVoiceTranscript, setIsVoiceTranscript] = useState(false);
  const [rawTranscript, setRawTranscript] = useState<string | null>(null);
  const [reviseError, setReviseError] = useState<string | null>(null);
  const [modeMenuOpen, setModeMenuOpen] = useState(false);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const historyPopupRef = useRef<HTMLDivElement>(null);
  const historyTriggerRef = useRef<HTMLButtonElement>(null);
  // Captured at the moment recording starts. Voice transcript is inserted
  // at this caret position (and replaces the selection, if any), matching
  // standard dictation behaviour (iOS / macOS / Google Docs).
  const voiceCaretRef = useRef<{ before: string; after: string } | null>(null);

  // Auto-resize textarea to fit content. Skipped in manual (drag-resized) mode.
  const autosize = useCallback(() => {
    const el = ref.current;
    if (!el || manualRef.current) return;
    el.style.height = "auto";
    el.style.height = el.scrollHeight + "px";
  }, []);

  /** Stream voice text into the textarea at the captured caret position,
   *  without committing (no caret move, no Revise-with-agent affordance).
   *  Used for live Speech-API interim updates. */
  const streamVoiceText = useCallback((s: string) => {
    const c = voiceCaretRef.current;
    setTextAndDraft(c ? c.before + s + c.after : s);
    setTimeout(autosize, 0);
  }, [setTextAndDraft, autosize]);

  /** Commit final voice text: insert at caret, move caret to end of insert,
   *  enable the Revise-with-agent affordance, refit textarea. */
  const commitVoiceText = useCallback((s: string) => {
    const c = voiceCaretRef.current;
    setTextAndDraft(c ? c.before + s + c.after : s);
    setIsVoiceTranscript(true);
    setTimeout(() => {
      const el = ref.current;
      if (!el) return;
      el.focus();
      if (c) {
        const pos = c.before.length + s.length;
        try { el.setSelectionRange(pos, pos); } catch { /* ignore */ }
      }
      autosize();
    }, 0);
  }, [setTextAndDraft, autosize]);

  useEffect(() => {
    if (!modeMenuOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!moreMenuRef.current?.contains(e.target as Node)) setModeMenuOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setModeMenuOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [modeMenuOpen]);

  // Close message-history popup on outside click. (Escape is handled inside
  // MessageHistory itself.)
  useEffect(() => {
    if (!showHistory) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (historyPopupRef.current?.contains(target)) return;
      if (historyTriggerRef.current?.contains(target)) return;
      setShowHistory(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [showHistory]);

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (disabled) return;
    if (!trimmed && !isDraft) return;

    // Intercept /discuss slash command
    if (trimmed.startsWith("/discuss ") || trimmed === "/discuss") {
      const topic = trimmed.slice("/discuss ".length).trim();
      import("@/store/sessionStore.ts").then(({ useSessionStore }) => {
        const store = useSessionStore.getState();
        store.createSubsession(
          sessionId,
          "discussion",
          topic || undefined,
          topic ? `Discuss: ${topic.slice(0, 40)}` : "Discussion"
        );
      }).catch(console.error);
      clearTextAndDraft();
      closeSuggestions();
      return;
    }

    onSend(trimmed, true);
    clearTextAndDraft();
    setIsVoiceTranscript(false);
    closeSuggestions();
    setPreviewActive(false);
    setPanelHeight(null);
    setTimeout(autosize, 0);
    ref.current?.focus();
  }, [text, disabled, isDraft, onSend, sessionId, closeSuggestions, clearTextAndDraft, autosize]);

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
    setTimeout(autosize, 0);
  }, [autosize]);

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

      // Mod+Enter always sends — wins over autocomplete's Enter→accept so
      // users can submit even when the popup happens to be open.
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

      // Escape closes history popup (only when autocomplete isn't claiming
      // Escape for itself — the hook handles Escape when its popup is open).
      if (e.key === "Escape" && showHistory && autocomplete.groups.length === 0) {
        e.preventDefault();
        setShowHistory(false);
        return;
      }

      // Delegate ArrowUp/Down/Tab/Enter/Escape navigation + accept to the
      // autocomplete hook.  Returns `true` only when the popup was open and
      // the key was consumed.
      if (autocomplete.onKeyDown(e)) return;
    },
    [handleSend, autocomplete, closeSuggestions, showHistory, insertFormat],
  );

  const handleChange = useCallback(
    (value: string) => {
      // Typing during dictation aborts the recording — standard behaviour
      // for dictation UIs. Otherwise live interim would race the keystroke
      // and overwrite what the user just typed.
      if (voice.isRecording) voice.cancelRecording();
      setTextAndDraft(value);
      setIsVoiceTranscript(false);
      // Draft-on-type: live-derive the tab name and arm autosave once the
      // prompt crosses the threshold.
      if (isDraft) {
        useSessionStore.getState().noteDraftInput(sessionIdRef.current, value);
      }
      // Autocomplete state is driven by the hook via the (text, caret)
      // props — no inline filtering needed here.  Caret state is updated
      // in the textarea's onSelect/onClick/onKeyUp handlers below.
    },
    [setTextAndDraft, voice, isDraft],
  );

  // Close the message-history popup when the autocomplete opens, so we
  // never stack the two over each other.  Replaces the inline
  // `setShowHistory(false)` call that used to live in `handleChange`.
  useEffect(() => {
    if (autocomplete.groups.length > 0 && showHistory) {
      setShowHistory(false);
    }
  }, [autocomplete.groups.length, showHistory]);

  // Keep the hook's caret state aligned with the textarea.  `onSelect`
  // fires on every caret move (keyboard, mouse, programmatic), so it's
  // the primary signal — the other two are belt-and-braces for engines
  // that don't dispatch `select` on every click.
  const updateCaret = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setCaret(el.selectionStart ?? 0);
  }, []);

  const handleHistorySelect = useCallback(
    (msg: string) => {
      setTextAndDraft(msg);
      setShowHistory(false);
      setTimeout(() => {
        ref.current?.focus();
        autosize();
      }, 0);
    },
    [setTextAndDraft, autosize],
  );

  const handleHistoryClose = useCallback(() => {
    setShowHistory(false);
    ref.current?.focus();
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

  // Stream Web Speech API interim text at the captured caret position
  // (between voiceCaretRef's `before` and `after`) instead of replacing
  // the whole textarea — matches standard dictation behaviour.
  useEffect(() => {
    if (voice.mode === "speech-api" && voice.isRecording && voice.interimText) {
      streamVoiceText(voice.interimText);
    }
  }, [voice.mode, voice.isRecording, voice.interimText, streamVoiceText]);

  const runRevise = useCallback(async (raw: string): Promise<void> => {
    try {
      const revised = await voice.reviseTranscript(raw);
      commitVoiceText(revised);
      setReviseError(null);
    } catch (e) {
      commitVoiceText(raw);
      setReviseError(e instanceof Error ? e.message : String(e));
    }
  }, [voice, commitVoiceText]);

  const startVoiceRecording = useCallback(() => {
    const el = ref.current;
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    voiceCaretRef.current = { before: text.slice(0, start), after: text.slice(end) };
    setRawTranscript(null);
    setReviseError(null);
    voice.startRecording();
  }, [voice, text]);

  const handleMicClick = useCallback(async () => {
    if (!voice.isRecording) {
      startVoiceRecording();
      return;
    }

    const transcript = await voice.stopRecording();
    if (!transcript) return;

    if (voiceReviseMode === "auto") {
      setRawTranscript(transcript);
      await runRevise(transcript);
      return;
    }

    commitVoiceText(transcript);

    if (voiceReviseMode === "subsession") {
      import("@/store/sessionStore.ts").then(({ useSessionStore }) => {
        useSessionStore.getState().createSubsession(
          sessionId,
          "refinement",
          transcript,
          "Revise voice input",
        );
      }).catch(console.error);
    }
  }, [voice, voiceReviseMode, sessionId, runRevise, commitVoiceText, startVoiceRecording]);

  const handleReviseRetry = useCallback(() => {
    if (rawTranscript) runRevise(rawTranscript);
  }, [rawTranscript, runRevise]);

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
        <div ref={historyPopupRef}>
          <MessageHistory onSelect={handleHistorySelect} onClose={handleHistoryClose} />
        </div>
      )}
      {reviseError && (
        <div className="input-revise-banner" role="alert">
          <span className="input-revise-banner-text">
            Auto-revise failed: {reviseError}
          </span>
          <button
            className="input-revise-banner-retry"
            onClick={handleReviseRetry}
            disabled={!rawTranscript || voice.isRevising}
          >
            Retry
          </button>
          <button
            className="input-revise-banner-close"
            onClick={() => setReviseError(null)}
            title="Dismiss"
            aria-label="Dismiss"
          >
            {"\u00D7"}
          </button>
        </div>
      )}
      {autocomplete.groups.length > 0 && (
        <div className="input-autocomplete" role="listbox" aria-label="Slash command suggestions">
          {autocomplete.groups.map((group, gi) => {
            // Flat-index offset for items rendered in earlier groups —
            // keyboard nav and `selectedIndex` are flat across both
            // sections (design doc §6.3).
            const offset = autocomplete.groups
              .slice(0, gi)
              .reduce((n, g) => n + g.items.length, 0);
            return (
              <div key={group.label} className="input-autocomplete-group">
                <div
                  className="input-autocomplete-section-header"
                  role="presentation"
                >
                  {group.label}
                </div>
                {group.items.map((skill, i) => {
                  const flatIndex = offset + i;
                  const active = flatIndex === autocomplete.selectedIndex;
                  return (
                    <button
                      key={`${group.label}-${skill.id}`}
                      role="option"
                      aria-selected={active}
                      ref={
                        active
                          ? (el) => {
                              // jsdom does not implement scrollIntoView —
                              // guard so unit tests don't crash.
                              if (el && typeof el.scrollIntoView === "function") {
                                el.scrollIntoView({ block: "nearest" });
                              }
                            }
                          : undefined
                      }
                      className={`input-autocomplete-item ${active ? "input-autocomplete-active" : ""}`}
                      onMouseDown={(e) => {
                        // Prevent the textarea from losing focus (which
                        // would close the popup via the caret leaving the
                        // /token range before `onClick` fires).
                        e.preventDefault();
                        const token = extractSlashToken(text, caret);
                        if (!token) return;
                        const replacement = `/${skill.id} `;
                        applyInsert({
                          start: token.start,
                          end: token.end,
                          replacement,
                          caretAfter: token.start + replacement.length,
                        });
                        autocomplete.close();
                      }}
                    >
                      {skill.icon && (
                        <span className="input-autocomplete-icon">{skill.icon}</span>
                      )}
                      <span className="input-autocomplete-name">/{skill.id}</span>
                      <span className="input-autocomplete-desc">{skill.description}</span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
      <div className={`input-editor-wrapper${isManual ? " input-editor-wrapper--fill" : ""}`}>
        <div className="input-split-pane" ref={splitPaneRef}>
          <textarea
            ref={ref}
            className={`input-textarea input-textarea--md${isManual ? " input-textarea--fill" : ""}${previewActive ? " input-textarea--split" : ""}`}
            style={previewActive ? { flex: splitRatio } : undefined}
            value={text}
            onChange={(e) => {
              handleChange(e.target.value);
              // Snap caret to the new selectionStart synchronously so the
              // autocomplete hook can recompute the active /token on the
              // same render.
              setCaret(e.target.selectionStart ?? 0);
              autosize();
            }}
            onSelect={updateCaret}
            onClick={updateCaret}
            onKeyUp={updateCaret}
            onKeyDown={handleKeyDown}
            onBlur={() => {
              if (isDraft) void draftAutosave.flush(sessionIdRef.current);
            }}
            placeholder={voice.isRevising ? "Revising..." : voice.isTranscribing ? "Transcribing..." : placeholder}
            disabled={disabled || voice.isTranscribing || voice.isRevising}
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
        ref={historyTriggerRef}
        className="input-icon-btn"
        onClick={() => {
          closeSuggestions();
          setShowHistory((v) => !v);
        }}
        title={`Message history (${modLabel("R")})`}
        aria-label="Message history"
      >
        <IconHistory />
      </button>
      {voice.isSupported && (
        <button
          className={`input-icon-btn${voice.isRecording ? " input-icon-btn--recording" : ""}${(voice.isTranscribing || voice.isRevising) ? " input-icon-btn--busy" : ""}`}
          onClick={handleMicClick}
          disabled={disabled || voice.isTranscribing || voice.isRevising}
          title={voice.isRecording ? "Stop recording" : "Start voice input"}
          aria-label={voice.isRecording ? "Stop recording" : "Start voice input"}
        >
          {(voice.isTranscribing || voice.isRevising) ? <span className="input-mic-spinner" /> : <IconMic />}
        </button>
      )}
      <div className="input-more-wrap" ref={moreMenuRef}>
        <button
          className="input-icon-btn"
          onClick={() => setModeMenuOpen((v) => !v)}
          title="More options"
          aria-label="More options"
          aria-haspopup="menu"
          aria-expanded={modeMenuOpen}
        >
          <IconMore />
        </button>
        {modeMenuOpen && (
          <div className="input-more-menu" role="menu">
            <button
              role="menuitemcheckbox"
              aria-checked={previewActive}
              className={`input-more-item${previewActive ? " input-more-item--active" : ""}`}
              onClick={() => {
                setPreviewActive((v) => !v);
                setModeMenuOpen(false);
                if (previewActive) setTimeout(() => ref.current?.focus(), 0);
              }}
            >
              <span className="input-more-check">{previewActive ? "\u2713" : ""}</span>
              <span className="input-more-label">Markdown preview</span>
            </button>
            {voice.isSupported && (
              <>
                <div className="input-more-group">Voice revise</div>
                <div className="input-more-chips">
                  {(["auto", "subsession", "off"] as const).map((m) => {
                    const active = voiceReviseMode === m;
                    const label = m === "auto" ? "Auto-revise" : m === "subsession" ? "Refinement subsession" : "Raw transcript";
                    return (
                      <button
                        key={m}
                        role="menuitemradio"
                        aria-checked={active}
                        className={`input-more-chip${active ? " input-more-chip-on" : " input-more-chip-off"}`}
                        onClick={() => useSettingsStore.getState().updateSettings({ voice_revise_mode: m })}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        )}
      </div>
      {isVoiceTranscript && text.trim() && (
        <button
          className="chat-btn"
          onClick={() => {
            import("@/store/sessionStore.ts").then(({ useSessionStore }) => {
              const store = useSessionStore.getState();
              store.createSubsession(sessionId, "refinement", text.trim(), "Revise voice input");
            }).catch(console.error);
            setIsVoiceTranscript(false);
          }}
        >
          Revise with agent
        </button>
      )}
      {/* Session-lifecycle actions (Continue / Start / Stop) — portal
          into the status line.  Send stays here next to the textarea. */}
      {actionPortalTarget && createPortal(
        <div className="input-actions">
          {showContinue && onContinue && (
            <button
              className="input-continue"
              onClick={onContinue}
              title="Continue without a message"
              aria-label="Continue"
            >
              <IconPlay />
            </button>
          )}
          {canInterrupt && onInterrupt && (
            <button className="input-interrupt" onClick={onInterrupt} aria-label="Stop">
              <IconStop />
            </button>
          )}
          {isDraft && (
            <button
              className="input-send"
              onClick={handleSend}
              disabled={disabled}
            >
              Start
            </button>
          )}
        </div>,
        actionPortalTarget,
      )}
      {!isDraft && !(isRunning && onInterrupt) && (
        <div className="input-actions">
          <button
            className="input-send"
            onClick={handleSend}
            disabled={disabled || !text.trim()}
          >
            Send
          </button>
        </div>
      )}
    </div>
  );
}
