# Voice Input — Architecture Design

> Parent: [DESIGN_DOC.md](../DESIGN_DOC.md) | Status: **Active** | Created: 2026-03-11

## Table of Contents
1. [Overview](#overview)
2. [Two-Mode Architecture](#two-mode-architecture)
3. [Data Flow](#data-flow)
4. [Changes by Layer](#changes-by-layer)
5. [Browser Compatibility](#browser-compatibility)
6. [Key Design Decisions](#key-design-decisions)
7. [Security Considerations](#security-considerations)
8. [Feature & Backend Specs](#feature--backend-specs)

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
| Transcription backend | [TRANSCRIBE.md](../backend/app/agent/TRANSCRIBE.md) | `transcribe()` function — base64 audio → Whisper → text |
| Frontend task | [feature_voice_input.md](../current_tasks/frontend/feature_voice_input.md) | useVoiceInput hook + InputArea mic button |
