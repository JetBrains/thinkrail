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
  macOS `osascript` (`choose folder`), Linux `zenity` then `kdialog` (whichever is installed), Windows a
  PowerShell `FolderBrowserDialog` (owned by an invisible top-most form — a background process can't take
  the foreground, so an unowned dialog opens behind the browser). `THINKRAIL_PICK_DIR` overrides it for
  dev/e2e; returns `null` when the user cancels. A missing binary falls through to the next candidate; a
  non-zero exit is a cancel for `osascript`/`zenity`/`kdialog` but a **failure** for PowerShell (it exits 0
  on cancel) — each `Picker` declares which. A failed picker, or no runnable candidate at all, **throws**:
  the picker is the only way to add a project, so a silent `null` is a dead button.
  **File-indirection:** when `THINKRAIL_PICK_DIR` names an existing
  *file*, the returned path is that file's trimmed contents, **re-read per call** — so one shared e2e host
  can hand different folders to different tests by rewriting the pointer (a directory value is returned
  as-is).
- **Public surface (barrel):** `selectDirectory` (+ `pickersFor` / `Picker` and the two message builders
  `pickerFailure` / `noPickerMessage`, exposed for unit tests).
- **Allowed deps:** Bun (spawn), `process.env`.
- **Forbidden:** `host`; sibling features; `contracts` (none needed).
