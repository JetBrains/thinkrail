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

- **Owns:** `selectDirectory()` — macOS `osascript` (`choose folder`); `THINKRAIL_PI_PICK_DIR` overrides it
  for dev/e2e; returns `null` on cancel / non-darwin.
- **Public surface (barrel):** `selectDirectory`.
- **Allowed deps:** Bun (spawn), `process.env`.
- **Forbidden:** `host`; sibling features; `contracts` (none needed).
