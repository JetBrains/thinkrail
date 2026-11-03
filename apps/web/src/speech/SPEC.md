---
id: submodule-web-speech
type: submodule-design
status: active
title: speech — local voice dictation in the browser
parent: module-web
depends-on: [module-contracts, submodule-web-transport, submodule-web-store]
references: [submodule-server-speech, architecture, module-resource-renderers]
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
      to 16 kHz, and posts 20 ms PCM16 frames with their RMS level. Its URL is imported dynamically at
      the first capture, so every module that reaches the barrel stays importable under `bun test`,
      which cannot resolve `?worker&url`.
  - **`micAvailability()`**: `insecure-origin` outside a secure context (HTTPS or localhost), or
    `unsupported` without `getUserMedia` / `AudioWorkletNode`.
  - **The page's one dictation controller** (`session.ts`, the `dictation` singleton).
  - **The text rule** (`text.ts`).
  - **The mic-state derivation** (`micState.ts`).
  - **`MicButton`**, the one mic every voice field renders, and the chord registry (`hotkey.ts`).
- **Public surface (barrel):** `MicButton`, `MicButtonProps`, `speechErrorKey`, `dictationShortcutLabel`,
  `DICTATION_EVENT`.
- **Internal:** capture, the controller, the text rule, the mic-state derivation, and the chord registry.
- **Forbidden:**
  - Submitting, steering, or touching the agent.
  - Persisting or reporting transcripts.
  - Opening its own socket URL: the endpoint is `transport`'s `openSpeechSocket`.

## Dictation controller

- **Start.**
  - `start(target)` ends any running dictation first. One per page, so a second field never interleaves
    with the first.
  - It opens the socket, sends `start` on open, and opens the microphone in parallel. Up to 5 s of early
    frames are held until the socket opens.
  - Phases go `connecting` → `listening` (on the host's `ready`) → `stopping` → `idle`.
- **Writing.** A target is `{ownerId, replace(spoken)}`. Each `partial` replaces the in-progress
  segment, each `final` commits it, and every change calls `replace(spokenText(finals, partial))`. The
  target owns where the text goes (see Fields).
- **Stop and end.**
  - `stop(ownerId?)` stops the microphone and sends `stop`. The host's last `final` and `ended` close
    it. A 12 s fallback counts from the stop, or from the host's `ready` when the stop came first: a cold
    engine may spend far longer loading the model, and the host buffers the audio meanwhile.
  - Every ending keeps what was recognized: a lost partial becomes a final.
  - A host `error`, a microphone failure (`denied`, `no-device`, `failed`), or a socket lost while not
    stopping ends the dictation. The snapshot keeps `{ownerId, code}` until the next start.
- **Snapshot.** `{ownerId, phase, level, error}` through `useDictationSnapshot` (`useSyncExternalStore`).
  `level` is the RMS ×4, clamped to 1, for the meter.

## Fields

`field.ts` lets dictation write into any text field without the field's owner doing anything.

- **Eligible** (`isDictationField` / `dictationFieldOf`):
  - `<input>` of type text, search, url, email, tel (or untyped), `<textarea>`, and a contenteditable
    host;
  - not read-only or disabled;
  - not inside `.monaco-editor` or `.xterm`. The code editor and the terminal are excluded by product
    decision: a misheard word there is code or a shell command.
- **Writing** (`fieldWriter(element)`): the dictation replaces the selection it started from, with
  `separators(before, after)` from `text.ts` putting spaces where a typist would, for every field kind.
  - **Inputs and textareas** are rewritten through the native `value` setter plus a bubbling `input`
    event, so a React-controlled field, the app's or an extension's, sees an ordinary `onChange`. The
    caret moves only while the field still has focus.
  - **Contenteditable** takes each update as one `execCommand("insertText")` over the span the previous
    one left, so the editor's own input handling and undo run.
    - The span is re-measured backwards from the caret after every insert, counting grapheme clusters
      (`Intl.Segmenter`), which is what `Selection.modify` steps by.
      - A fixed start plus an offset drifted once Chrome rewrote a neighbouring `&nbsp;` ("hello fix"
        came out as "hellofix thex").
      - Counting UTF-16 units ate the user's text before Devanagari or emoji.
    - The neighbouring characters for `separators` are read with `Selection.modify`, so a line or block
      break reads as a break and a new line gets no leading space.
    - Without focus there is no selection to write through, so a final arriving after a blur leaves the
      last partial in place.
- **Lock.** `lock()` makes the field read-only (a contenteditable cancels every `beforeinput` but
  ours) and swallows Enter in capture phase, so no field submits mid-dictation.
- **`thinkrail:dictation`** (`DICTATION_EVENT`, `{listening}`) bubbles from the field when its dictation
  starts and ends, so an owner can hold its own submit button.

## Mic button

`MicButton {fieldRef, apply, onListeningChange?, fallback?, disabled?, size?}` is the only mic UI; `useFieldApply(ref,
setValue)` is the `apply` for a plain controlled field. The field owner
keeps its value, caret and submit path. `apply` must never move focus: late finals arrive after a blur
has stopped the dictation, and focusing the field then would steal the user's next input. The composer
restores the caret only while the field is still focused. It follows the mockup states in the task
design:

- **States.**
  - `offer`: click opens the setup card (`aria-haspopup="dialog"`, `aria-expanded`; closing it
    returns focus to the mic). It shows the download size in MB and, after a failure, the
    failure with **Try again**. **Download** sends `speech.install {model}`; nothing downloads without
    that click.
  - `installing`: a spinner icon, a tooltip with the percentage, and a click cancels. It deliberately
    avoids `IconButton`'s `loading`, which disables the button and would swallow both the click and the
    tooltip; `aria-busy` is set instead.
  - `ready`: click toggles dictation.
  - While starting, a spinner and "Starting voice input…".
  - While listening, a danger-toned selected icon with a 4-bar level meter.
  - `unavailable`: disabled, with the reason as the tooltip.
  - `hidden`: nothing is rendered.
- **Field lock.** Starting focuses the field. While its dictation runs, the mic sets the field
  `readOnly`, reports `onListeningChange`, and stops on Esc (captured before the field's own handlers),
  on blur, or when the mic unmounts (a tab switch or a closed dialog). Pressing the mic itself never
  blurs: `onMouseDown` prevents default.
- **Errors.** A dictation failure of its own is a toast: a warning for microphone access, an error
  otherwise.
  - A `denied` / `no-device` failure turns every installed mic `blocked`: the mic-off icon, still
    clickable, with a tooltip naming where to allow access (System Settings → Privacy & Security →
    Microphone, or the browser).
  - The next click retries, so granting access needs no reload.
  - An earlier version disabled the mic until reload. That left a user who had fixed the permission
    with no way back.
- **Chord.** ⌘⇧Space on Apple, Ctrl+Shift+Space elsewhere.
  - Window capture-phase listeners exist only while a mic is mounted.
  - The target is the focused registered field. Otherwise, when no modal layer is open and focus is in
    no other text entry (an input, Monaco, xterm), it is the most recently focused `fallback` field (the
    chat composer), else the last mounted one. The chord focuses it. In every other case the chord passes
    through untouched.
  - A press starts or stops. If that press started a dictation and the key is held ≥ 300 ms, releasing
    Space or a modifier stops it (push-to-talk); a quicker tap leaves it running (toggle).
  - Repeats are swallowed.

## Mic state

`micState(status, availability, microphoneBlocked)` gives each field's mic one of these states:

- `hidden`: a pre-v103 host (`speech === null`);
- `unavailable` with a reason: `unsupported-platform` (the host has no pinned runtime),
  `insecure-origin`, or `unsupported-browser`;
- `installing` with bytes;
- `ready`: installed, or a failed switch whose older model still works;
- `blocked` with `denied` / `no-device`: installed, but the last dictation could not open the microphone
  (clickable to retry);
- `offer`: the download for the failed model (or `DEFAULT_SPEECH_MODEL`, multilingual), with its size
  and any failure code to retry.
