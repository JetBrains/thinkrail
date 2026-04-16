# Task: Mobile Voice Input (Android MVP)

> Status: **Pending** | Created: 2026-04-16

## Summary

Add voice input parity to the mobile app: mic button on the session detail screen,
Android `MediaRecorder`-based capture, and the same auto-revise pipeline used by the
web frontend. Mobile honors `voice_revise_mode ∈ { "auto", "off" }`; the `"subsession"`
value gracefully degrades to `"auto"` (mobile has no subsession support yet).

## Covers

- `mobile/shared/src/commonMain/kotlin/dev/aiir/bonsai/voice/AudioRecorder.kt` — `expect` API
- `mobile/shared/src/androidMain/kotlin/dev/aiir/bonsai/voice/AudioRecorder.kt` — Android impl
- `mobile/shared/src/commonMain/kotlin/dev/aiir/bonsai/network/rpc/RpcMethods.kt` (add `agentTranscribe`, `agentReviseTranscript`)
- `mobile/shared/src/commonMain/kotlin/dev/aiir/bonsai/data/model/Settings.kt` (`voiceReviseMode`)
- `mobile/shared/src/commonMain/kotlin/dev/aiir/bonsai/component/session/SessionDetailComponent.kt`
- `mobile/shared/src/commonMain/kotlin/dev/aiir/bonsai/component/session/SessionDetailComponentImpl.kt`
- `mobile/androidApp/src/androidMain/kotlin/dev/aiir/bonsai/android/ui/screen/SessionDetailScreen.kt`
- `mobile/androidApp/src/androidMain/AndroidManifest.xml` + `.../debug/AndroidManifest.xml` — `RECORD_AUDIO`

## Acceptance Criteria

- [ ] `AudioRecorder` common API (`start`, `stop`, `cancel`) with Android `MediaRecorder`
      implementation producing `{ base64, mimeType = "audio/mp4" }`.
- [ ] RPC wrappers `agentTranscribe(audioBase64, mimeType)` and
      `agentReviseTranscript(text, model?)` callable from `SessionDetailComponentImpl`.
- [ ] Mobile `ProjectSettings.voiceReviseMode` syncs from backend (snake → camel via
      existing `JsonConfig`).
- [ ] `SessionDetailComponent` state fields `isRecording`, `isTranscribing`, `isRevising`,
      `voiceError`, `rawTranscript`; actions `startVoiceInput`, `stopVoiceInput`,
      `retryRevise`.
- [ ] `SessionDetailScreen` shows a mic `IconButton` between the text field and the
      send/interrupt button; it shows a `CircularProgressIndicator` during
      `isTranscribing || isRevising`; disables the text field during those phases.
- [ ] A dismissible banner above the input renders when `voiceError != null` with a
      Retry button.
- [ ] `RECORD_AUDIO` permission is requested at runtime on first mic press; denial
      surfaces via the same banner.
- [ ] `voice_revise_mode == "subsession"` is treated as `"auto"` on mobile; toast
      explains the degradation once per session.
- [ ] `./gradlew :androidApp:assembleDebug` succeeds.

## Design Reference

- Parent design: [.bonsai/design_docs/VOICE_INPUT_DESIGN.md](../../design_docs/VOICE_INPUT_DESIGN.md) (Revision 2 — Mobile Parity)
- Mobile architecture: [.bonsai/design_docs/MOBILE_FRONTEND_DESIGN.md](../../design_docs/MOBILE_FRONTEND_DESIGN.md)
- Backend dependency: [feature_revise_transcript.md](../agent/feature_revise_transcript.md)
