---
id: submodule-server-dialog
type: submodule-design
status: active
title: dialog — native folder picker
parent: module-server
tags: [v1]
---

## Responsibility

The host's native directory picker, so the browser "Open project" gets a real OS dialog.

## Boundary

- **Owns:** `selectDirectory()` — the host's native folder picker, per OS via `pickersFor(platform)`:
  macOS `osascript` (`choose folder`), Linux `zenity` then `kdialog`, Windows a PowerShell
  `FolderBrowserDialog`. `THINKRAIL_PICK_DIR` overrides it for dev/e2e and is resolved before native
  availability checks. It returns `null` **only** when the user cancels. Picker completion is classified
  from exit code plus diagnostics: AppleScript's `-128` marker and Linux exit 1 without stderr are
  cancellation; Linux exit 1 with diagnostics (including GTK's `Failed to open display`) and every
  PowerShell non-zero exit are failures. Linux with neither `DISPLAY` nor `WAYLAND_DISPLAY` fails before
  spawn with an actionable no-graphical-session reason. A missing or failed candidate falls through to the
  next candidate; cancellation stops. If all candidates are missing or fail, the method throws the most
  useful observed reason, because a silent `null` is a dead button.
  **File-indirection:** when `THINKRAIL_PICK_DIR` names an existing *file*, the returned path is that
  file's trimmed contents, **re-read per call** — so one shared e2e host can hand different folders to
  different tests by rewriting the pointer (a directory value is returned as-is).
- **Windows: the dialog must come up focused, in front of the browser.** The host is a background
  process, and Windows only lets the process that *owns* the foreground call `SetForegroundWindow` — so a
  plain `ShowDialog()` opens behind the browser, unfocused, reading as "the button does nothing". An
  invisible top-most owner form is **not sufficient on its own**: measured on Windows 11 with an unrelated
  app in front, the dialog came up unfocused in 3/3 runs — visible, but the keyboard still belonged to the
  browser. What works is the documented way past the foreground lock: the script `AttachThreadInput`s to
  the foreground window's thread (sharing its input queue makes our `SetForegroundWindow` legal),
  foregrounds the owner form, detaches, then shows the dialog **owned** by that now-foreground form.
  Measured on Windows 11: focused and on top in 3/3 runs, Enter selects the highlighted folder, Escape
  returns `null` at exit 0. The whole grab is **best-effort** — wrapped so a host that can't compile the
  P/Invoke, or an elevated foreground app that refuses the steal, degrades to the old behaviour (the
  dialog still opens, just behind) instead of failing the pick.
  The script is handed over as `-EncodedCommand` (base64/UTF-16LE), not `-Command`: it is multi-line and
  contains the double quotes of P/Invoke signatures, which Windows argv quoting plus PowerShell's own
  re-parse do not preserve.
- **Public surface (barrel):** `selectDirectory` (+ `pickersFor` / `Picker` and the two message builders
  `pickerFailure` / `noPickerMessage`, exposed for unit tests).
- **Allowed deps:** Bun (spawn), `process.env`.
- **Forbidden:** `host`; sibling features; `contracts` (none needed).
