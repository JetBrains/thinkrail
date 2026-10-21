---
id: submodule-server-locales
type: submodule-design
status: draft
title: locales — user language files in the data dir
parent: module-server
depends-on: [module-contracts, module-locales]
tags: [i18n]
---

## Responsibility

Reads, validates, and watches the user's local language files in `<dataDir>/locales/` (the global data
dir only, never a workspace — [[architecture]] Decision 23) and reports them to clients. It owns no
translation logic: validation and file naming come from [[module-locales]].

## Boundary

- **Owns:** creating the folder on start; scanning `*.json` (non-JSON and dot-prefixed names ignored);
  per-file status; the debounced folder watcher; the size caps (2 MB per file, 64 files — the rest are
  reported as errors).
- **Public surface (barrel):** `localesDir()`, `readLocalLocales(dir?)` (read on every request — a
  handful of small files, so no cache to invalidate), `watchLocalLocales({ dir?, onChange })` → stop
  function, and the caps `MAX_LOCALE_FILE_BYTES` / `MAX_LOCALE_FILES`.
- **Wire** (gated by `LOCALES_PROTOCOL_VERSION`): `locales.list` → `{ dir, files }`, each file
  `{ tag, fileName, ok: true, strings } | { tag: string | null, fileName, ok: false, error, detail? }`
  where `error` is a code (`invalid-name`, `duplicate`, `too-large`, `too-many`, `unreadable`,
  `invalid-json`, `not-object`) the client translates and `detail` is the untranslated parser/OS text;
  `locales.changed` is an **invalidation nudge, not data** — clients re-read `locales.list`, the same
  pattern as `workspace.fsChanged`; `locales.reveal` → `Ack` (`host` composes `localesDir()` with `editors`' file-manager reveal).
- **Allowed deps:** `persistence` (`dataDir`), `log`; external
  `@thinkrail/locales` root.
- **Forbidden:** `settings` (the chosen language is an `AppConfig` field; which tag is effective is a
  client decision), `agent`, any workspace path.

## Get right

- A broken file never blocks the others — including one whose validation throws: invalid JSON (with line/column when the parser reports one), a
  non-object root, an invalid file name, or an oversize file becomes an `ok: false` entry.
- The watcher is best-effort: a watch failure logs and leaves `locales.list` correct on the next read.
  Bursts (editor save = write + rename) coalesce into one nudge.
- The folder may be deleted, replaced (`mv backup locales`) or recreated while the host runs: a second,
  non-recursive watcher on the data dir reattaches the folder watcher whenever the `locales` entry changes
  and nudges. The host creates the folder once at start and never again — re-creating a deleted folder
  itself would make a later `mv` nest the replacement inside it.
