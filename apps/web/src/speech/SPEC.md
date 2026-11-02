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
  - **`MicButton`**, the one mic every voice field renders, and the chord registry (`hotkey.ts`).
- **Public surface (barrel):** `MicButton`, `MicButtonProps`, `speechErrorKey`, `micAvailability`, `MicAvailability`, `dictation`, `useDictationSnapshot`,
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
    it. A 12 s fallback counts from the stop, or from the host's `ready` when the stop came first: a cold
    engine may spend far longer loading the model, and the host buffers the audio meanwhile.
  - Every ending keeps what was recognized: a lost partial becomes a final.
  - A host `error`, a microphone failure (`denied`, `no-device`, `failed`), or a socket lost while not
    stopping ends the dictation. The snapshot keeps `{ownerId, code}` until the next start.
- **Snapshot.** `{ownerId, phase, level, error}` through `useDictationSnapshot` (`useSyncExternalStore`).
  `level` is the RMS ×4, clamped to 1, for the meter.

## Mic button

`MicButton {fieldRef, apply, onListeningChange?, scope?, fallback?}` is the only mic UI. The field owner
keeps its value, caret and submit path. It follows the mockup states in the task design:

- **States.**
  - `offer`: click opens the setup card. It shows the download size in MB and, after a failure, the
    failure with **Try again**. **Download** sends `speech.install {model}`; nothing downloads without
    that click.
  - `installing`: a spinner, a tooltip with the percentage, and a click cancels.
  - `ready`: click toggles dictation.
  - While starting, a spinner and "Starting voice input…".
  - While listening, a danger-toned selected icon with a 4-bar level meter.
  - `unavailable`: disabled, with the reason as the tooltip.
  - `hidden`: nothing is rendered.
- **Field lock.** While its dictation runs it sets the field `readOnly`, reports `onListeningChange`, and
  stops on Esc (captured before the field's own handlers) or blur. Pressing the mic itself never blurs:
  `onMouseDown` prevents default.
- **Errors.** A dictation failure of its own is a toast (a warning for microphone access, an error
  otherwise). A `denied` / `no-device` failure keeps every mic `unavailable` until reload, since nothing
  can start a new dictation to clear it.
- **Chord.** ⌘⇧Space on Apple, Ctrl+Shift+Space elsewhere.
  - Window capture-phase listeners exist only while a mic is mounted.
  - The target is the focused registered field, else the most recently focused `fallback` field (the
    chat composer), else the last mounted one. The chord focuses it.
  - A press starts or stops. If that press started a dictation and the key is held ≥ 300 ms, releasing
    Space or a modifier stops it (push-to-talk); a quicker tap leaves it running (toggle).
  - Repeats are swallowed.

## Mic state

`micState(status, availability, microphoneBlocked)` gives each field's mic one of these states:

- `hidden`: a pre-v103 host (`speech === null`);
- `unavailable` with a reason: `unsupported-platform` (the host has no pinned runtime),
  `insecure-origin`, `unsupported-browser`, or a latched `denied` / `no-device`;
- `installing` with bytes;
- `ready`: installed, or a failed switch whose older model still works;
- `offer`: the download for the failed model (or `DEFAULT_SPEECH_MODEL`, multilingual), with its size
  and any failure code to retry.
