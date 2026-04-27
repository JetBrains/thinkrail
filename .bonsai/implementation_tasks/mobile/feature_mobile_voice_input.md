---
id: task-mobile-voice-input
type: task-spec
status: draft
title: Mobile Voice Input (Android MVP)
implements:
- voice-input-design
depends-on:
- task-revise-transcript
- mobile-frontend-design
tags:
- voice
- mobile
- android
---
# Task: Mobile Voice Input (Android MVP)

> Status: **Pending** | Created: 2026-04-16

## Summary

Add voice input parity to the mobile app: mic button on the session detail screen,
Android `MediaRecorder`-based capture, and the same auto-revise pipeline used by the
web frontend. Mobile honors `voice_revise_mode ∈ { "auto", "off" }`; the `"subsession"`
value gracefully degrades to `"auto"` (mobile has no subsession support yet).

## Covers

- `mobile/androidApp/src/androidMain/kotlin/dev/aiir/bonsai/android/voice/SpeechRecognizerTranscriber.kt` — on-device recognizer wrapper (primary path)
- `mobile/shared/src/commonMain/kotlin/dev/aiir/bonsai/voice/AudioRecorder.kt` — fallback API
- `mobile/shared/src/androidMain/kotlin/dev/aiir/bonsai/voice/AndroidAudioRecorder.kt` — Android MediaRecorder impl (fallback)
- `mobile/shared/src/commonMain/kotlin/dev/aiir/bonsai/network/rpc/RpcMethods.kt` (`agentTranscribe`, `agentReviseTranscript`)
- `mobile/shared/src/commonMain/kotlin/dev/aiir/bonsai/data/model/Settings.kt` (`voiceReviseMode`)
- `mobile/shared/src/commonMain/kotlin/dev/aiir/bonsai/component/session/SessionDetailComponent.kt`
- `mobile/shared/src/commonMain/kotlin/dev/aiir/bonsai/component/session/SessionDetailComponentImpl.kt`
- `mobile/androidApp/src/androidMain/kotlin/dev/aiir/bonsai/android/ui/screen/SessionDetailScreen.kt`
- `mobile/androidApp/src/androidMain/AndroidManifest.xml` — `RECORD_AUDIO`

## Acceptance Criteria

### Primary path — on-device SpeechRecognizer

- [ ] `SpeechRecognizerTranscriber.isAvailable(context)` chooses the primary path when
      an Android recognizer is installed (typical on Google-services-enabled devices).
- [ ] `SessionDetailScreen` instantiates `SpeechRecognizerTranscriber` and drives it
      from the mic button; no backend call is made to transcribe the audio.
- [ ] Partial results stream into the `messageInput` field live as the user speaks.
- [ ] On final result, `component.onVoiceTranscript(raw)` runs the revise step per
      `voice_revise_mode` and the final (possibly revised) text replaces `messageInput`.
- [ ] Recognizer errors are translated to a user-visible message via
      `component.reportVoiceError(msg)`.

### Fallback path — MediaRecorder + backend Whisper

- [ ] When `SpeechRecognizerTranscriber.isAvailable` returns false, `AndroidAudioRecorder`
      + `component.onAudioRecorded(base64, mime)` are used instead.
- [ ] If `OPENAI_API_KEY` is unset on the backend, the RPC error surfaces in the
      banner with the original message from `transcribe.py` (not just "internal error").

### Shared

- [ ] Mobile `ProjectSettings.voiceReviseMode` syncs from backend (snake → camel via
      `JsonConfig`).
- [ ] `SessionDetailComponent` exposes `onAudioRecorded`, `onVoiceTranscript`,
      `retryRevise`, `reportVoiceError`, `dismissVoiceError` and state fields
      `isTranscribing`, `isRevising`, `voiceError`, `rawTranscript`.
- [ ] `RECORD_AUDIO` permission is requested at runtime on first mic press; denial
      surfaces via the banner.
- [ ] `voice_revise_mode == "subsession"` is treated as `"auto"` on mobile (mobile has
      no subsession support yet).
- [ ] `./gradlew :androidApp:assembleDebug` succeeds.

## Design Reference

- Parent design: [.bonsai/design_docs/VOICE_INPUT_DESIGN.md](../../design_docs/VOICE_INPUT_DESIGN.md) (Revision 2 — Mobile Parity)
- Mobile architecture: [.bonsai/design_docs/MOBILE_FRONTEND_DESIGN.md](../../design_docs/MOBILE_FRONTEND_DESIGN.md)
- Backend dependency: [feature_revise_transcript.md](../agent/feature_revise_transcript.md)
