# Task: Voice Input

> Status: **Done** | Created: 2026-03-11

## Summary

Implement browser voice input with two transcription modes: Web Speech API (Chrome/Edge) for real-time interim results, and MediaRecorder + OpenAI Whisper (all browsers) as fallback.

## Covers

- `frontend/src/hooks/useVoiceInput.ts`
- `frontend/src/components/ChatStream/InputArea.tsx`
- `backend/app/agent/transcribe.py`

## Acceptance Criteria

- [x] `useVoiceInput` hook detects browser capabilities and selects best mode
- [x] Speech API mode streams interim text into textarea in real-time
- [x] MediaRecorder mode records audio, sends base64 to backend, shows spinner
- [x] Backend `transcribe()` calls OpenAI Whisper API and returns text
- [x] Mic button visible only when `isSupported` is true
- [x] Recording auto-stops after 2 minutes (MAX_RECORDING_MS)
- [x] Microphone permission denial shows toast notification
- [x] Missing OPENAI_API_KEY shows descriptive error message

## Design Reference

- Feature design: [.bonsai/design_docs/VOICE_INPUT_DESIGN.md](../design_docs/VOICE_INPUT_DESIGN.md)
- Backend submodule: [backend/app/agent/TRANSCRIBE.md](../../backend/app/agent/TRANSCRIBE.md)
