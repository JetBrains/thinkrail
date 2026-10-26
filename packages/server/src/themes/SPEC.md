---
id: submodule-server-themes
type: submodule-design
status: active
title: themes — user theme files in the data dir
parent: module-server
depends-on: [module-contracts]
references: [submodule-web-themes, submodule-server-locales]
tags: [ui, themes]
---

## Responsibility

Reads and watches the user's theme files in `<dataDir>/themes/*.theme.json` (the global data dir only,
never a workspace, so a cloned repo cannot restyle the app) and reports them to clients. It knows the
file container, not the theme: the manifest schema, id rules, and catalog belong to
[[submodule-web-themes]], which validates every file it receives.

## Boundary

- **Owns:** creating the folder on start; scanning `*.theme.json` (dot-prefixed names ignored); the
  per-file read status; the size caps (256 KB per file, 64 files — the rest report `too-many`); the
  folder poller.
- **Public surface (barrel):** `themesDir()`, `readUserThemes(dir?)` (read on every request — a handful
  of small files, so no cache), `watchUserThemes({ dir?, onChange, intervalMs? })` → stop function,
  and the caps `MAX_THEME_FILE_BYTES` / `MAX_THEME_FILES` / `MAX_THEME_NESTING`.
- **Wire** (gated by `USER_THEMES_PROTOCOL_VERSION`): `themes.list` → `{ dir, files }`, each file
  `{ fileName, ok: true, manifest } | { fileName, ok: false, error, detail? }` with `error` one of
  `too-large`, `too-many`, `unreadable`, `invalid-json` and `manifest` the parsed, unvalidated JSON;
  `themes.changed` is an invalidation nudge, not data; `themes.reveal` → `Ack` (`host` composes
  `themesDir()` with `editors`' file-manager reveal).
- **Allowed deps:** `persistence` (`dataDir`), `log`.
- **Forbidden:** the theme schema or any colour knowledge, `settings` (which theme is active is an
  `AppConfig` field the client resolves), `agent`, any workspace path.

## Get right

- A broken file never blocks the others — including a pathologically nested one: JSON nested deeper
  than `MAX_THEME_NESTING` (32; a manifest needs 2) reports `invalid-json` before parsing, because such a
  value can parse yet overflow the stack when the host serializes the whole `themes.list` response.
- Change detection is the same once-a-second folder-signature poll as [[submodule-server-locales]]
  (see its spec for why it does not use `fs.watch`), and the folder is created once at start, never
  re-created.
