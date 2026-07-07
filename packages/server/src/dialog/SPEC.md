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
  PowerShell `FolderBrowserDialog`. `THINKRAIL_PICK_DIR` overrides it for dev/e2e; returns `null` on
  cancel or when no native picker is available. A missing binary falls through to the next candidate; a
  non-zero exit is a user cancel.
- **Public surface (barrel):** `selectDirectory` (+ `pickersFor` / `Picker`, exposed for unit tests).
- **Allowed deps:** Bun (spawn), `process.env`.
- **Forbidden:** `host`; sibling features; `contracts` (none needed).
