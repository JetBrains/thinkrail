---
id: task-voice-auto-revise
type: task-spec
status: draft
title: Voice Auto-Revise (Web Frontend)
implements:
- voice-input-design
depends-on:
- task-revise-transcript
tags:
- voice
- frontend
---
# Task: Voice Auto-Revise (Web Frontend)

> Status: **Pending** | Created: 2026-04-16

## Summary

Replace the default "start refinement subsession" behavior after a voice transcription
with a one-shot server-side revise call. Preserve the subsession flow as an explicit
opt-in ("Revise with agent" button + `voice_revise_mode = "subsession"` setting).

## Covers

- `frontend/src/hooks/useVoiceInput.ts`
- `frontend/src/components/ChatStream/InputArea.tsx`
- `frontend/src/api/methods/settings.ts` (`voice_revise_mode` field)

## Acceptance Criteria

- [ ] `useVoiceInput` exposes `isRevising: boolean` and
      `reviseTranscript(text): Promise<string>`; calls `agent/reviseTranscript`.
- [ ] `InputArea.handleMicClick` branches on `voice_revise_mode`:
      `"auto"` → transcript → revise → input box;
      `"subsession"` → transcript → `createSubsession(..., "refinement", ...)` (v1 behavior);
      `"off"` → transcript → input box, no revise, no subsession.
- [ ] Textarea disabled during `isTranscribing || isRevising`; placeholder reflects the
      current phase.
- [ ] On revise failure, the raw transcript remains in the box and a dismissible banner
      shows the error plus a Retry button that replays the revise call.
- [ ] "Revise with agent" button still appears whenever a voice transcript is present
      (all three modes) and still spawns a refinement subsession with the current draft.
- [ ] Mode selector UI next to the mic button allows switching between the three values
      (writes through `updateSettings`).

## Design Reference

- Parent design: [.bonsai/design_docs/VOICE_INPUT_DESIGN.md](../../design_docs/VOICE_INPUT_DESIGN.md) (Revision 2)
- Backend dependency: [feature_revise_transcript.md](../agent/feature_revise_transcript.md)
