---
id: submodule-web-speech
type: submodule-design
status: active
title: speech — local voice dictation in the browser
parent: module-web
depends-on: [module-contracts, submodule-web-transport, submodule-web-store]
references: [submodule-server-speech]
tags: [speech, voice, public-surface-checked]
---

## Responsibility

Turns the microphone into text in a field. Mic audio streams to the host's `/speech` socket
([[module-contracts]] § Voice input), where NVIDIA's local engine transcribes it
([[submodule-server-speech]]). The recognized text streams into the field the dictation started in. Nothing
is ever sent to the agent by dictation: the text lands in the draft and the field's own submit path
sends it.

## Boundary

- **Owns:**
  - **Capture** (`capture.ts` + `pcmWorklet.ts`):
    - `getUserMedia` with echo cancellation, noise suppression and auto gain.
    - An AudioWorklet (bundled through Vite's `?worker&url`) that mixes to mono, box-filter decimates
      to 16 kHz, and posts 20 ms PCM16 frames with their RMS level.
  - **`micAvailability()`**: `insecure-origin` outside a secure context (HTTPS or localhost), or
    `unsupported` without `getUserMedia` / `AudioWorkletNode`.
  - **The page's one dictation controller** (`session.ts`, the `dictation` singleton).
  - **The text rule** (`text.ts`).
  - **The mic-state derivation** (`micState.ts`).
- **Public surface (barrel):** `micAvailability`, `MicAvailability`, `dictation`, `useDictationSnapshot`,
  `micState`, `MicState`, `MicUnavailableReason`, `DEFAULT_SPEECH_MODEL`, `DictationError`,
  `DictationPhase`, `DictationScope`, `DictationSnapshot`, `DictationTarget`, `dictationText`,
  `spokenText`, `DictationAnchor`.
- **Forbidden:**
  - Submitting, steering, or touching the agent.
  - Persisting or reporting transcripts.
  - Opening its own socket URL: the endpoint is `transport`'s `openSpeechSocket`.

## Dictation controller

- **Start.**
  - `start(target)` ends any running dictation first. One per page, so a second field never interleaves
    with the first.
  - It reads the target's anchor (its text and selection) once.
  - It opens the socket, sends `start {workspaceId?, sessionId?}` on open, and opens the microphone
    in parallel. Up to 5 s of early frames are held until the socket opens.
  - Phases go `connecting` → `listening` (on the host's `ready`) → `stopping` → `idle`.
- **Writing.** Each `partial` replaces the in-progress segment, and each `final` commits it. The field is
  rewritten as `dictationText(anchor, spokenText(finals, partial))`:
  - the dictation replaces the original selection;
  - a separating space goes where a typist would put one (none after whitespace, an opening bracket,
    `@`, `#`, `/` or `-`; none before closing punctuation);
  - the caret sits after the spoken text.
- **Stop and end.**
  - `stop(ownerId?)` stops the microphone and sends `stop`. The host's last `final` and `ended` close
    it, with a 12 s fallback.
  - Every ending keeps what was recognized: a lost partial becomes a final.
  - A host `error`, a microphone failure (`denied`, `no-device`, `failed`), or a socket lost while not
    stopping ends the dictation. The snapshot keeps `{ownerId, code}` until the next start.
- **Snapshot.** `{ownerId, phase, level, error}` through `useDictationSnapshot` (`useSyncExternalStore`).
  `level` is the RMS ×4, clamped to 1, for the meter.

## Mic state

`micState(status, availability, microphoneBlocked)` gives each field's mic one of these states:

- `hidden`: a pre-v103 host (`speech === null`);
- `unavailable` with a reason: `unsupported-platform` (the host has no pinned runtime),
  `insecure-origin`, `unsupported-browser`, or a latched `denied` / `no-device`;
- `installing` with bytes;
- `ready`: installed, or a failed switch whose older model still works;
- `offer`: the download for the failed model (or `DEFAULT_SPEECH_MODEL`, multilingual), with its size
  and any failure code to retry.
