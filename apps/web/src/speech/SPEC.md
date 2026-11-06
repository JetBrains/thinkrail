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
  - **The dictation layer** (`DictationLayer.tsx` + `control.ts`), mounted once in `main.tsx`: it is the
    only mic UI and the owner of the dictation chord (`hotkey.ts`).
- **Public surface (barrel):** `DictationLayer`, `DICTATION_EVENT`, `speechErrorKey`, `dictationShortcutLabel`.
- **Internal:** capture, the controller, the field writers, the text rule, the mic-state derivation, and
  the chord.
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

## Dictation layer

Voice input reaches every text field, the app's and any extension's, without the field doing anything.
An earlier version gave each field its own hand-placed mic component, which every field and every
extension had to adopt and wire up. It was replaced so voice is a property of the page, not of fields.

- **Off switch.** `AppConfig.voiceInputEnabled` (Settings → Voice input) gates the whole layer. Off, it
  renders nothing and installs no focus or chord listeners, so the chord reaches the page untouched;
  switching off stops a running dictation. Downloaded files stay until deleted.
- **Focus following.** Document `focusin` / `focusout` track the eligible field that has focus (see
  Fields). Focus moving into the layer's own DOM (`[data-dictation-layer]`) does not count as leaving.
  While a dictation runs, its field stays the target even without focus.
- **The mic** is rendered through a portal and re-placed against the field's rect whenever the field,
  the page or its container resizes or anything scrolls (one `requestAnimationFrame` per burst; no idle
  frame loop, which kept the desktop renderer awake at 60 Hz): inside the right edge, at the bottom corner of a field 40 px or taller, centred vertically on a
  single line. A field narrower than 96 px gets no mic, though the chord still works there.
  - It portals into the field's nearest `[role="dialog"]` or Radix popper wrapper, absolutely
    positioned against it (including its scroll offset and border), so it sits inside that layer's focus trap and outside-click guard. Elsewhere
    it is fixed to the viewport.
  - When focus leaves, the mic is hidden (`hidden`), not unmounted, until another field takes focus or
    its field leaves the page. Radix focus scopes move focus to their container whenever a node inside
    them is removed while focus is on `body`. Removing the mic mid-focus-change closed a model-picker
    popover on a click inside it, and broke a field's own focus restore after it disabled itself.
    For the same reason, the blur that ends a dictation acts a task later, once focus has landed. A
    window blur (app switch) leaves `activeElement` on the field, so that check also stops when the
    document has no focus.
  - It is a plain element, not a Radix popover: an always-open dismissable layer swallowed Escape for
    dialogs underneath.
- **States** follow Mic state.
  - `offer`: the setup card, a Radix popover anchored to the mic. It does not take focus; its buttons
    keep the field focused.
  - `installing`: a spinner and a percentage; a click cancels. It avoids `IconButton`'s `loading`, which
    disables the button.
  - Listening shows a danger-toned mic with a 4-bar level meter. `blocked` and `unavailable` show the
    mic-off icon with the reason.
  - Pressing the mic never moves focus (`onMouseDown` prevents default). Dictation failures are toasts.
- **Lifecycle** (`control.ts`).
  - `startDictation(field)` focuses the field, takes its writer, locks it, announces
    `thinkrail:dictation`, and starts the page's one dictation. Blur or a newer start ends it; the
    chord or the mic stop it on purpose.
  - **Esc is not a dictation key** (user decision). It keeps whatever meaning the page gives it:
    Escape in a dialog closes the dialog, whose field blur then ends the dictation and drops its draft
    with it, exactly as for typed text. An earlier version stopped dictation on Esc. A dialog's
    dismiss runs first, so making Esc stop dictation without closing the dialog would have needed a
    second window capture owner of Escape.
  - When the controller goes idle or changes owner, the field is unlocked and the end is announced.
  - Owners are per element (`WeakMap`), so starting another field ends the first.
- **Chord.** ⌘⇧Space on Apple, Ctrl+Shift+Space elsewhere, through one pair of window capture listeners.
  - The target is the field being dictated into when it has focus (it is read-only meanwhile, so no
    longer eligible, and a second press must still reach it to stop). Otherwise it is the focused
    eligible field. If none is focused, and no modal layer is open and focus
    is in no other text entry (Monaco, xterm, a password), it falls back to the most recently focused
    `[data-dictation-fallback]` field, the chat composer, else the first one on the page. The chord
    focuses it. Otherwise the chord passes through untouched.
  - A tap toggles. A press that started a dictation and is held ≥ 300 ms stops on release
    (push-to-talk). Repeats are swallowed.
- **An active IME owns its keys** (apps/web's IME rule): the chord and the lock's Enter swallow
  both yield to an open composition (`isImeComposing`).
- **Submit holding** is generic: the lock swallows Enter, ⌘↩ included. A field whose owner has its own
  submit button can hold it on `thinkrail:dictation`, as the composer does with Send. Buttons elsewhere
  are not disabled.

## Mic state

`micState(status, availability, microphoneBlocked)` gives each field's mic one of these states:

- `hidden`: a pre-v105 host (`speech === null`);
- `unavailable` with a reason: `unsupported-platform` (the host has no pinned runtime),
  `insecure-origin`, or `unsupported-browser`;
- `installing` with bytes;
- `ready`: installed, or a failed switch whose older model still works;
- `blocked` with `denied` / `no-device`: installed, but the last dictation could not open the microphone
  (clickable to retry);
- `offer`: the download for the failed model (or `DEFAULT_SPEECH_MODEL`, multilingual), with its size
  and any failure code to retry.
