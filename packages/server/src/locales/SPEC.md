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
  per-file status; the folder poller; the size caps (2 MB per file, 64 files — the rest are
  reported as errors).
- **Public surface (barrel):** `localesDir()`, `readLocalLocales(dir?)` (read on every request — a
  handful of small files, so no cache to invalidate), `watchLocalLocales({ dir?, onChange, intervalMs? })` → stop
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
- Change detection polls, it does not use `fs.watch`: once a second (`intervalMs`) it compares a
  signature of the folder's locale files (name, inode, size, mtime, ctime — ctime catches a `chmod`
  repair or a rewrite that restores its mtime) and nudges when it differs. A burst
  (editor save = write + rename) inside one tick is one nudge; an empty folder appearing or vanishing is
  none. Bun on Linux shares one inotify watch per path across every `fs.watch` in the process, so after
  the folder or the whole data dir is deleted and recreated, re-watching the path can return a dead
  watcher whenever another host watcher still holds it — CI's e2e setup recreates the data dir after the
  host starts, with the jbcentral artifact watcher on it. A dozen `stat`s a second has no such failure
  mode and needs no reattach logic.
- The host creates the folder once at start and never again — re-creating a deleted folder itself would
  make a later `mv backup locales` nest the replacement inside it.
