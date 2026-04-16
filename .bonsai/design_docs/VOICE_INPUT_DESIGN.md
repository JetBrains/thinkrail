# Voice Input — Architecture Design

> Parent: [DESIGN_DOC.md](../../DESIGN_DOC.md) | Status: **Active** | Created: 2026-03-11 | Updated: 2026-04-16

## Table of Contents
1. [Overview](#overview)
2. [Two-Mode Architecture](#two-mode-architecture)
3. [Data Flow](#data-flow)
4. [Changes by Layer](#changes-by-layer)
5. [Browser Compatibility](#browser-compatibility)
6. [Key Design Decisions](#key-design-decisions)
7. [Security Considerations](#security-considerations)
8. [Feature & Backend Specs](#feature--backend-specs)
9. [Revision 2 — Auto-Revise + Mobile (2026-04-16)](#revision-2--auto-revise--mobile-2026-04-16)

## Overview

Voice input provides hands-free text entry for agent sessions. Users click a mic button in the InputArea to dictate messages, which are transcribed and placed into the textarea for review before sending.

The feature uses **progressive enhancement** with two transcription modes: a fast browser-native path (Web Speech API) and a server-side fallback (MediaRecorder + OpenAI Whisper). The mode is auto-detected at runtime based on browser capabilities — no user configuration required.

## Two-Mode Architecture

```
User clicks mic
  │
  ├── speech-api mode (Chrome, Edge)
  │     Web Speech API → real-time interim text → final text
  │     No server round-trip. Zero latency for interim results.
  │
  └── media-recorder mode (all modern browsers)
        MediaRecorder → audio blob → base64 → RPC → Whisper → text
        Server round-trip required. Shows spinner during transcription.
```

### Mode Detection

```typescript
function detectMode(): VoiceMode {
  if (window.webkitSpeechRecognition || window.SpeechRecognition)
    return "speech-api";
  if (navigator.mediaDevices?.getUserMedia && window.MediaRecorder)
    return "media-recorder";
  return "unsupported";
}
```

Detection runs once on hook mount. The `isSupported` flag hides the mic button entirely when `"unsupported"`.

## Data Flow

### Speech API Mode (Chrome/Edge)

```
mic button → SpeechRecognition.start()
  → onresult (interim) → interimText state → textarea updates live
  → stopRecording() → SpeechRecognition.stop()
  → onresult (final) → resolve Promise with final transcript
```

- Interim results appear in the textarea in real-time as the user speaks
- Final transcript replaces interim text on stop
- No backend involvement

### MediaRecorder Mode (Fallback)

```
mic button → getUserMedia() → MediaRecorder.start()
  → recording... (up to MAX_RECORDING_MS = 120s)
  → stopRecording() → MediaRecorder.stop()
  → ondataavailable → Blob → base64
  → RPC: agent/transcribe { audioBase64, mimeType }
  → backend: transcribe.py → OpenAI Whisper API
  → response: { text }
  → resolve Promise with transcribed text
```

- No interim results — textarea shows "Transcribing..." placeholder
- Spinner replaces mic icon during transcription
- 2-minute auto-stop timeout prevents runaway recordings

## Changes by Layer

### Backend

| File | Change |
|------|--------|
| `agent/transcribe.py` | New module: `transcribe(audio_base64, mime_type) -> str`. Decodes base64 audio, sends to OpenAI Whisper API, returns text. Lazy imports `openai` package. |
| `rpc/methods/agents.py` | New RPC method: `agent/transcribe`. Extracts `audioBase64` + `mimeType` params, delegates to `transcribe()`, returns `{ text }`. Catches `ImportError` for missing module. |

No changes to: `service.py`, `runner.py`, `tracker.py`, `models.py`.

### Frontend

| File | Change |
|------|--------|
| `hooks/useVoiceInput.ts` | New hook: dual-mode voice input with `startRecording()`, `stopRecording()`, `interimText`, `isRecording`, `isTranscribing`, `isSupported`, `mode`, `error` |
| `components/ChatStream/InputArea.tsx` | Mic button (conditional on `isSupported`), recording/transcribing CSS states, interim text sync to textarea, handleMicClick toggle |

### Hook Interface

```typescript
interface UseVoiceInputReturn {
  isSupported: boolean;
  mode: "speech-api" | "media-recorder" | "unsupported";
  isRecording: boolean;
  isTranscribing: boolean;
  interimText: string;
  error: string | null;
  startRecording: () => void;
  stopRecording: () => Promise<string>;
}
```

## Browser Compatibility

| Mode | Browsers | Behavior |
|------|----------|----------|
| `speech-api` | Chrome, Edge | Real-time interim results, no server needed |
| `media-recorder` | Firefox, Safari, Chrome, Edge | Server-side Whisper, spinner during transcription |
| `unsupported` | Older browsers, no mic | Mic button hidden entirely |

## Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Progressive enhancement | Auto-detect best mode per browser | Best UX: instant results when available, functional fallback everywhere |
| 2-minute timeout | `MAX_RECORDING_MS = 120_000` | Prevents forgotten recordings consuming memory; Whisper has size limits |
| base64 transport | Audio sent as base64 string over JSON-RPC | Avoids multipart/form-data complexity; reuses existing WebSocket transport |
| Interim text in textarea | Speech API interim results written directly to textarea | User sees transcription happening in real-time; natural and responsive |
| Optional `openai` dependency | Lazy import with graceful `RuntimeError` | Backend starts without OpenAI; only fails when media-recorder mode is actually used |
| No auto-send | Transcript placed in textarea, not auto-sent | User can review and edit before sending |

## Security Considerations

- **Microphone permissions:** Browser prompts for mic access on first use; `NotAllowedError` caught and shown as toast
- **Whisper API key:** Required only for media-recorder mode; `OPENAI_API_KEY` env var; `RuntimeError` with helpful message if missing
- **Audio not persisted:** Base64 audio is transient — not saved to disk, not logged, not stored in session events

## Feature & Backend Specs

| Component | Spec | Description |
|-----------|------|-------------|
| Transcription backend | [TRANSCRIBE.md](../../backend/app/agent/TRANSCRIBE.md) | `transcribe()` function — base64 audio → Whisper → text |
| Revision backend (v2) | [REVISE.md](../../backend/app/agent/REVISE.md) | `revise_transcript()` — raw transcript → Claude Haiku → concise message |
| Frontend task (v1) | [feature_voice_input.md](../../.bonsai/implementation_tasks/frontend/feature_voice_input.md) | useVoiceInput hook + InputArea mic button |
| Frontend task (v2) | [feature_voice_auto_revise.md](../../.bonsai/implementation_tasks/frontend/feature_voice_auto_revise.md) | Auto-revise flow + mode selector + failure banner |
| Agent task (v2) | [feature_revise_transcript.md](../../.bonsai/implementation_tasks/agent/feature_revise_transcript.md) | `revise.py` + `agent/reviseTranscript` RPC |
| Mobile task (v2) | [feature_mobile_voice_input.md](../../.bonsai/implementation_tasks/mobile/feature_mobile_voice_input.md) | KMP `AudioRecorder`, RPC wrappers, Android mic UI |

---

## Revision 2 — Auto-Revise + Mobile (2026-04-16)

### Motivation

The v1 design placed a raw transcript into the input box and offered a **"Revise with
agent"** button that spawned a refinement subsession — a whole new agent with its own
turn loop — to clean up the text. That is heavyweight for what is normally a one-shot
copy-edit. v2 replaces the default with a server-side one-shot LLM call that lands
directly in the input box, and demotes the subsession flow to an explicit opt-in.

### User-visible flow (web)

```
mic → speak → stop
  → transcript obtained (Web Speech API final text, or Whisper response)
  → one-shot revise call (agent/reviseTranscript)
  → revised text appears in the input box
  → user presses Send
    …or clicks "Revise with agent" to promote the current draft into a subsession
```

### Setting: `voice_revise_mode`

Stored in `.bonsai/settings.json`; three values:

| Value | Behavior |
|---|---|
| `"auto"` (default) | One-shot revise after transcription. New v2 behavior. |
| `"subsession"` | Start a refinement subsession immediately after transcription. v1 behavior preserved. |
| `"off"` | Raw transcript only; no automatic action. "Revise with agent" button still available. |

The **"Revise with agent"** button remains available in `"auto"` and `"off"` modes whenever
a voice transcript is present, as an opt-in path for iterative refinement.

### Data flow (v2, auto mode)

```
mic → speak → stop
  → [if speech-api]   recognition.onend → final text
  → [if media-recorder] Blob → base64 → RPC agent/transcribe → Whisper → text
  → RPC agent/reviseTranscript { text }
  → backend revise_transcript() → Anthropic (Haiku) → revised text
  → response: { text }
  → setTextAndDraft(revised); isVoiceTranscript = true
```

On failure (missing API key, network error, SDK error) the raw transcript is kept in the
box and a small dismissible banner appears above the input:

> Auto-revise failed: `<reason>` · [Retry]

The Retry button replays `reviseTranscript` against the stashed raw transcript.

### Hook interface (v2 additions)

```typescript
interface UseVoiceInputReturn {
  // v1 fields
  isSupported: boolean;
  mode: "speech-api" | "media-recorder" | "unsupported";
  isRecording: boolean;
  isTranscribing: boolean;
  interimText: string;
  error: string | null;
  startRecording: () => void;
  stopRecording: () => Promise<string>;
  // v2 additions
  isRevising: boolean;
  reviseTranscript: (text: string) => Promise<string>;
}
```

The textarea is disabled while `isTranscribing || isRevising` is true; placeholder
updates to `"Transcribing…"` then `"Revising…"`.

### Backend additions

| File | Change |
|---|---|
| `backend/app/agent/revise.py` | New module. `async def revise_transcript(text, model=None) -> str`. Uses `anthropic.AsyncAnthropic(api_key=resolve_anthropic_api_key())`. Defaults to `claude-haiku-4-5`. Single-turn, `max_tokens=2048`, no streaming. |
| `backend/app/rpc/methods/agents.py` | New handler `revise_transcript_rpc`, registered as `agent/reviseTranscript`. Params: `{ text, model? }`. Returns `{ text }`. |
| `backend/app/core/settings.py` | New field `voice_revise_mode: str = "auto"` on `ProjectSettings`. |

See [REVISE.md](../../backend/app/agent/REVISE.md) for the submodule spec.

### Mobile parity (Android MVP)

Mobile gains a mic button with the same one-shot-revise behavior. Because the mobile app
does not yet support subsessions, mobile only honors `voice_revise_mode ∈ { "auto", "off" }`;
the `"subsession"` value gracefully degrades to `"auto"` with a toast.

| Layer | Change |
|---|---|
| `mobile/shared/.../voice/AudioRecorder.kt` | New `expect class` in `commonMain`; Android `actual` uses `MediaRecorder` (MPEG_4 / AAC) into cache-dir temp file → base64. |
| `mobile/shared/.../network/rpc/RpcMethods.kt` | New typed wrappers `agentTranscribe(...)` and `agentReviseTranscript(...)`. |
| `mobile/shared/.../data/model/Settings.kt` | New field `voiceReviseMode: String?`. |
| `mobile/shared/.../component/session/SessionDetailComponent[Impl].kt` | New methods (`startVoiceInput`, `stopVoiceInput`, `retryRevise`) and state fields (`isRecording`, `isTranscribing`, `isRevising`, `voiceError`, `rawTranscript`). |
| `mobile/androidApp/.../ui/screen/SessionDetailScreen.kt` | Mic `IconButton` in the bottom-bar `Row`; disabled states; dismissible failure banner above the input. |
| `mobile/androidApp/.../AndroidManifest.xml` (both variants) | `<uses-permission android:name="android.permission.RECORD_AUDIO" />`; runtime prompt on first mic press. |

### Security / privacy considerations (v2)

- The revise call sends plain text (the transcript) to the Anthropic API. This is already
  the case for any agent session, but it is worth calling out for users in high-trust
  environments: setting `voice_revise_mode = "off"` avoids any LLM call on the transcript.
- No audio or transcript is persisted by the backend for this path (Whisper path already
  transient per v1; revise path receives text only and returns text only).
